// Map204 — "tells someone a workspace has been shared with them".
//
// Why this is a function and not a request from the browser: the Resend key is a
// secret, and a secret in the browser is not a secret. The anon key is public by
// design, so nothing that can send mail may hang off it.
//
// The function is also the authorisation boundary. It re-checks that the caller is
// signed in **and** is the owner or an editor of that workspace, using the service
// role key, before it will name the workspace in an email. Without that check the
// endpoint would be an open relay: anyone signed in could ask it to mail the
// contents of any workspace they had been lent, to any address.
//
// A failed email never undoes the share. The grant is written first; the mail is a
// notification afterwards, and the dialog says so plainly if it does not go out.
//
// The words live in `email-template.ts`, because this file's job is deciding
// *whether* to send and that is a different job from writing one.

import { createClient } from 'jsr:@supabase/supabase-js@2'

import { ICON_LABELS, WORKSPACE_ACCENT_HEX } from './_workspace_look.ts'
import { renderEmail, subjectFor } from './email-template.ts'

const RESEND_URL = 'https://api.resend.com/emails'
/** Where the link points. Overridable so a preview deployment cannot send real mail. */
const APP_URL = Deno.env.get('APP_URL') ?? 'https://map204.vercel.app'
const FROM = Deno.env.get('MAIL_FROM') ?? 'Map204 <onboarding@resend.dev>'

/* -------------------------------------------------------------------------- */
/* CORS                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The origin allowed to call this.
 *
 * An allow-list, not `*`, and not an echo of the request's `Origin`. The function
 * sends mail: anyone who can make it send can put mail in any inbox, and a
 * reflected origin would let any website on the internet do that with a signed-in
 * person as the unwitting trigger.
 *
 * `ALLOWED_ORIGINS` below is the list. Anything not on it gets no
 * `Access-Control-Allow-Origin`, which means the browser refuses to show the
 * response -- which is the correct outcome, not an error to be worked around.
 */
const ALLOWED_ORIGINS = [
  'https://map204.vercel.app',
  // Local development, where the app runs on Vite's port and Supabase's local
  // stack calls this function over the network.
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

/**
 * CORS headers for a response, or an empty object if this origin is not allowed.
 *
 * `Vary: Origin` is not optional. Without it a shared cache can serve one origin's
 * response to another, which turns an allow-list into a suggestion.
 *
 * ## Why this exists at all
 *
 * It did not, and every email failed with a CORS error in the browser console:
 *
 *   Cross-Origin Request Blocked: The Same Origin Policy disallows reading the
 *   remote resource at .../send-share-email. (Reason: CORS header
 *   'Access-Control-Allow-Origin' missing). Status code: 405.
 *
 * Two faults, either of which is fatal on its own:
 *
 *   1. The function answered `405 Method not allowed` to the `OPTIONS` preflight,
 *      because it rejected every method that was not `POST`. The browser sends a
 *      preflight because the request carries an `Authorization` header and a JSON
 *      content type, so it is not a "simple" one; it never got to send the `POST`.
 *   2. No response carried `Access-Control-Allow-Origin` at all, so even a
 *      successful `POST` would have been unreadable.
 *
 * The 405 in the message is the misleading half: it looks like the function
 * refused the email, when it never saw an email.
 */
function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? ''
  if (!ALLOWED_ORIGINS.includes(origin)) return { Vary: 'Origin' }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    // Ten minutes. Long enough that a redeploy does not invalidate every tab, short
    // enough that removing an origin from the list takes effect on a rebuild.
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

/**
 * A response with CORS applied. Every response in this function goes through here.
 *
 * `null` for the body is not a style choice. A 204 is a "no content" status and the
 * fetch specification forbids a body on it -- and Deno enforces that rather than
 * ignoring it:
 *
 *   TypeError: Response with null body status cannot have body
 *       at respond (file:///.../index.ts:83:10)
 *
 * So `new Response('', { status: 204 })` does not send an empty 204, it throws, the
 * runtime answers 500, and *that* response has no CORS headers -- which puts the
 * bug back exactly where it started, on the one request whose whole job is to
 * succeed silently.
 *
 * Found by running the function against Supabase's own edge runtime, not by reading
 * it: every source-level check passed, and the preflight still failed. See
 * `scripts/test-share-email-live.cjs`.
 */
function respond(request: Request, body: unknown, status: number): Response {
  const nullBody = status === 204 || status === 205 || status === 304

  return new Response(
    nullBody ? null : typeof body === 'string' ? body : JSON.stringify(body),
    {
      status,
      headers: nullBody
        ? corsHeaders(request)
        : {
            ...corsHeaders(request),
            'Content-Type': typeof body === 'string' ? 'text/plain;charset=UTF-8' : 'application/json',
          },
    },
  )
}

/* -------------------------------------------------------------------------- */

/**
 * The whole handler, wrapped.
 *
 * A throw anywhere in here is answered by the edge gateway, not by this function.
 * The gateway's own 502 is a fixed 60-byte body carrying `sb-error-code:
 * EDGE_FUNCTION_ERROR`, naming neither the message nor the stack and none of this
 * function's CORS headers -- which is precisely the confusion the CORS work above
 * was done to remove, one layer up:
 *
 *   the browser reports a bare 502, the dashboard reports an error code, and
 *   nothing anywhere says `Cannot read properties of undefined`
 *
 * So nothing is allowed to escape. Every failure becomes a real response with CORS
 * on it, the reason is logged where the function logs can be read, and the caller
 * gets text it can put in a dialog.
 */
Deno.serve(async (request) => {
  try {
    return await handle(request)
  } catch (error) {
    // The stack rather than the message, and logged before the response, because
    // the response is deliberately vague: this is a share notification, not a
    // debugging channel, and it should not become a way to read the server's
    // internals by asking it to fail.
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    console.error('[send-share-email] unhandled:', message)
    return respond(request, { error: 'The email could not be sent.' }, 500)
  }
})

async function handle(request: Request): Promise<Response> {
  // The preflight. Answered before anything else -- it carries no `Authorization`
  // header by definition, so every check below would refuse it.
  //
  // `null`, not `''`: see `respond`. A 204 cannot carry a body, and passing an
  // empty string throws rather than sending an empty 204.
  if (request.method === 'OPTIONS') {
    return respond(request, null, 204)
  }

  if (request.method !== 'POST') {
    return respond(request, { error: 'Method not allowed.' }, 405)
  }

  const authHeader = request.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return respond(request, { error: 'Not signed in.' }, 401)
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) {
    return respond(request, { error: 'Mail is not configured on this deployment.' }, 503)
  }

  let payload
  try {
    payload = await request.json()
  } catch {
    return respond(request, { error: 'Malformed request.' }, 400)
  }

  const { documentId, to } = payload ?? {}
  if (!documentId || !to) {
    return respond(request, { error: 'documentId and to are required.' }, 400)
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) {
    return respond(request, { error: 'Not signed in.' }, 401)
  }
  const me = userData.user

  // The same rule the RLS policy applies to writes, so a viewer cannot use this
  // to mail out the contents of a workspace they were only lent.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: doc } = await admin
    .from('documents')
    .select('id, title, accent, icon, owner_id')
    .eq('id', documentId)
    .maybeSingle()

  if (!doc) {
    return respond(request, { error: 'That workspace does not exist.' }, 404)
  }

  // Ownership is `documents.owner_id`, *not* a row in document_collaborators.
  // The owner has no collaborator row to join against, so checking the owner first
  // is what makes this work for the person who actually shares; the collaborator
  // lookup only covers the editors they have since invited.
  let canShare = doc.owner_id === me.id

  if (!canShare) {
    const { data: collab } = await admin
      .from('document_collaborators')
      .select('role')
      .eq('document_id', documentId)
      .eq('user_id', me.id)
      .maybeSingle()

    canShare = collab?.role === 'owner' || collab?.role === 'editor'
  }

  if (!canShare) {
    return respond(request, { error: 'Only the owner of a workspace can share it.' }, 403)
  }

  // The colour and label the recipient will see come from the same tables the
  // app uses, so the email cannot describe a workspace differently from the
  // workspace itself.
  const accent = WORKSPACE_ACCENT_HEX[doc.accent as string] ?? WORKSPACE_ACCENT_HEX.indigo
  const iconLabel = ICON_LABELS[doc.icon as string] ?? 'General'

  const sharerName = me.user_metadata?.name ?? me.user_metadata?.full_name ?? me.email ?? 'Someone'
  const role = payload.role === 'viewer' ? 'viewer' : 'editor'

  /*
   * Two different emails, decided by whether the recipient already has an account.
   *
   * This function used to send one email with one link -- straight to the workspace
   * -- which only works for somebody already signed in. Inviting somebody who is not
   * was impossible then, so this never came up; now that it is possible, the same
   * link would drop a stranger on a sign-in page with no explanation of what they
   * were invited to.
   *
   * The lookup is on `public.profiles`, the same place `find_profile_by_email`
   * looks, so the two agree about who has an account. A miss is not an error: the
   * join email is the right message for an address nobody has registered, and a race
   * between two simultaneous signups is not a failure worth refusing mail over.
   */
  const { data: recipient } = await admin
    .from('profiles')
    .select('id')
    .eq('email', to.trim().toLowerCase())
    .maybeSingle()

  const hasAccount = Boolean(recipient?.id)
  const link = hasAccount
    ? `${APP_URL}/w/${encodeURIComponent(documentId)}`
    : // Straight to sign-in. There is no join route with the address pre-filled --
      // the only authentication is Google -- so putting the address in the query is
      // decoration that goes stale the moment somebody uses it, and Google ignores it
      // anyway. The address is in the body so they can check they are signing in as
      // the right person.
      `${APP_URL}/?invited=${encodeURIComponent(documentId)}`

  const details = {
    workspaceTitle: doc.title,
    accent,
    iconLabel,
    sharerName,
    role,
    link,
    hasAccount,
    invitedEmail: to.trim().toLowerCase(),
  }

  let result: { id?: string } | null = null
  try {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        // From the template, beside the body, so the two cannot describe different
        // things: a change to one that forgot the other would send a mail whose
        // subject promised a workspace and whose body invited a signup.
        subject: subjectFor(details),
        html: renderEmail(details),
      }),
    })

    result = await response.json()

    if (!response.ok) {
      console.error('[send-share-email] resend refused:', response.status, result)
      return respond(request, { error: 'The email could not be sent.' }, 502)
    }
  } catch (error) {
    // A network failure or a non-JSON body from Resend. Caught rather than thrown,
    // because an uncaught error in an edge function returns 500 with no CORS
    // headers and the browser reports "failed to fetch" instead of the reason --
    // which is the exact confusion this function's CORS handling was just fixed to
    // remove.
    console.error('[send-share-email] could not reach resend:', error)
    return respond(request, { error: 'The email could not be sent.' }, 502)
  }

  return respond(request, { ok: true, id: result?.id ?? null }, 200)
}

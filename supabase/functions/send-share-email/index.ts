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
import { createSupabaseContext } from 'npm:@supabase/server'

import { ICON_LABELS, WORKSPACE_ACCENT_HEX } from './_workspace_look.ts'
import { renderEmail, subjectFor } from './email-template.ts'

const RESEND_URL = 'https://api.resend.com/emails'
/** Where the link points. Overridable so a preview deployment cannot send real mail. */
const APP_URL = Deno.env.get('APP_URL') ?? 'https://map204.vercel.app'
const FROM = Deno.env.get('MAIL_FROM') ?? 'Map204 <onboarding@resend.dev>'

/* -------------------------------------------------------------------------- */
/* Keys                                                                       */
/* -------------------------------------------------------------------------- */

/*
 * There are none in this file, and that is the fix.
 *
 * Three separate faults came from reading the keys by hand, each invisible in the
 * source and each fatal on its own:
 *
 *   1. `SUPABASE_ANON_KEY` is a *legacy JWT key*. Building a client with it put that
 *      key in the client's `Authorization` header, so verifying the caller's token
 *      meant checking it against the anon key's signing secret. The gateway signs
 *      with the project's own JWKS, and the two do not match -- so every signed-in
 *      caller was refused with "token signature is invalid".
 *   2. `auth.getUser()` with no argument reads the *client's session*, and an edge
 *      function has none: no localStorage, nobody signed in as far as the process is
 *      concerned. It refused every caller whatever token they presented.
 *   3. `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` hold a JSON *object*
 *      keyed by name, not a string, and were read with a bare `Deno.env.get`.
 *
 * `withSupabase({ auth: 'user' })` does the one thing all three were attempting,
 * with the project's real signing keys (`SUPABASE_JWKS`), and the runtime injects
 * every variable it needs. So this function no longer reads, parses, or passes a key
 * at all -- which also means there is nothing here for a secret to leak into.
 *
 * See https://supabase.com/docs/guides/functions/auth
 */

/*
 * A word about `onboarding@resend.dev`, because it is a trap and it was the reason
 * every invitation failed.
 *
 * Resend lets you send without setting up a domain, and the address it lets you use
 * is `onboarding@resend.dev` -- but *only* to the address on the Resend account.
 * Any other recipient is refused with a 403 and a message about the sender.
 *
 * So a deployment with no `MAIL_FROM` set looks completely healthy: the key is
 * there, the function starts, the share works, and every email is refused. The
 * default is kept because it is the right thing for a first send to yourself, and
 * warned about here because it is the wrong thing for everything after it.
 */
if (!Deno.env.get('MAIL_FROM')) {
  console.warn(
    '[send-share-email] MAIL_FROM is not set, so every email is sent as ' +
      'onboarding@resend.dev. Resend only allows that address to send to the ' +
      'account that owns the key, so invitations to anyone else will be refused. ' +
      'Set MAIL_FROM to a verified address, e.g. "Map204 <hello@yourdomain.com>".',
  )
}

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
 * The whole handler, wrapped twice.
 *
 * ## The outer wrapper: nothing escapes
 *
 * A throw anywhere in here is answered by the edge gateway, not by this function.
 * The gateway's 502 is a fixed 60-byte body carrying `sb-error-code:
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
 *
 * ## The inner wrapper: the SDK's context
 *
 * `createSupabaseContext` rather than `withSupabase`, and both the reason and the
 * alternative are below the call. The short version: `withSupabase` answers CORS
 * itself with `Access-Control-Allow-Origin: *`, which on a function that sends mail
 * is an open relay, and it treats the preflight as an authenticated request it has
 * to refuse. The docs' own escape hatch is the right tool here -- it verifies the
 * token and hands back a context without ever touching the response.
 *
 * `auth: 'none'`, and this is deliberate rather than an oversight: the SDK verifies a
 * token when one is present but does not *require* one, because a CORS preflight
 * carries no `Authorization` header. `handle` requires one, from the verified
 * claims, on the line `if (!ctx.authenticated)`. So the credential is checked, and
 * checked by the SDK, which is the part that is hard to get right.
 */

/** What the SDK's context is called. Only the fields actually used are named. */
interface SupabaseContext {
  authenticated: boolean
  claims?: Record<string, unknown>
  error?: { message?: string }
  supabaseAdmin: ReturnType<typeof createClient>
}

Deno.serve(async (request) => {
  // Every response goes through `respond`, and *only* through `respond`. The
  // alternative -- `withSupabase` wrapping the handler -- is what the docs show, and
  // it was tried here first, and it breaks this function twice over:
  //
  //   1. It answers CORS itself, before this handler runs, and what it sends is
  //      `Access-Control-Allow-Origin: *` with a method list including DELETE. On a
  //      function that sends mail that is an open relay: any website on the internet
  //      could make it send, with a signed-in person as the unwitting trigger. The
  //      allow-list above exists precisely to prevent that, and the SDK's wrapper
  //      overrides it -- a preflight it answers itself never reaches the check.
  //   2. It turns the OPTIONS preflight into an authenticated request, which carries
  //      no Authorization header, so under `auth: 'user'` it is refused before the
  //      handler sees it. That is the original bug in this file, arriving by a
  //      different route.
  //
  // `createSupabaseContext` is the documented way out: "use it instead when you want
  // to shape the response yourself" -- which is exactly this case, since every
  // response here carries a deliberate allow-list. It verifies the token using the
  // project's signing keys and hands back the same context, without ever touching
  // the response.
  const { data: context, error: contextError } = await createSupabaseContext(request, {
    auth: 'none',
  })

  /*
   * `error` lives on the *tuple*, not on the context.
   *
   * `createSupabaseContext` returns `{ data, error }`, and when a caller is not
   * authenticated the data is absent and the reason is in the second half. Reading
   * `ctx.error` instead -- which is where `withSupabase` would have put it -- always
   * found nothing, so every refusal came back as the bare "Not signed in." and the
   * reason the SDK had worked out was thrown away.
   *
   * That distinction is the whole point of using the SDK: it can tell an expired
   * token from a forged one, from a malformed header, from a preflight with no
   * credentials at all, and the client can act on the difference. This is where that
   * reason is kept.
   */
  const ctx = {
    ...(context ?? {}),
    // Only set when the context could not be built, which is the only case where the
    // context itself has nothing to say about it.
    ...(context ? {} : { error: { message: contextError?.message ?? 'Not signed in.' } }),
  } as unknown as SupabaseContext

  try {
    return await handle(request, ctx)
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

async function handle(request: Request, ctx: SupabaseContext): Promise<Response> {
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

  /*
   * The caller's identity, already verified.
   *
   * `ctx` comes from `withSupabase({ auth: 'user' })`, which checks the caller's
   * session token against `SUPABASE_JWKS` -- the project's real signing keys -- and
   * hands back claims that have been verified rather than merely decoded. See the
   * note above about the three ways this was done by hand before, and why each of
   * them failed.
   *
   * So the claims below can be trusted: an id taken from an unverified token would
   * make the ownership check that follows worthless, and that check is the only
   * thing standing between this endpoint and being an open relay.
   */
  if (!ctx.authenticated) {
    // The SDK's own reason, because an expired token and a forged one are different
    // problems and used to arrive as the same "Not signed in."
    return respond(request, { error: ctx.error?.message ?? 'Not signed in.' }, 401)
  }

  const claims = (ctx.claims ?? {}) as {
    sub?: unknown
    email?: unknown
    name?: unknown
    user_metadata?: { name?: unknown } | null
  }

  const me = {
    id: typeof claims.sub === 'string' ? claims.sub : '',
    email: typeof claims.email === 'string' ? claims.email : '',
    name:
      (typeof claims.user_metadata?.name === 'string' ? claims.user_metadata.name : undefined) ??
      (typeof claims.name === 'string' ? claims.name : undefined) ??
      'Someone',
  }

  if (!me.id) {
    // A verified token with no subject is not something a real sign-in produces, so
    // it is worth saying so in the logs rather than treating as anonymous.
    console.error('[send-share-email] the verified token carries no subject claim.')
    return respond(request, { error: 'Not signed in.' }, 401)
  }

  /*
   * The privileged client, for the two queries that have to see rows the caller
   * cannot.
   *
   * `ctx.supabaseAdmin` is authenticated with the secret key and carries BYPASSRLS.
   * The decision that spends it has already been made above: the caller is the owner
   * or an editor, checked against `documents.owner_id` and
   * `document_collaborators`. That is the same rule the RLS policies apply to
   * writes, so a viewer -- somebody lent the map -- is refused.
   *
   * Reading `profiles` is the other one, and it is not the sharer's business whether
   * an address has an account, so the lookup is done with elevated access and
   * nothing but a boolean is taken from it. That boolean is what chooses between the
   * two emails.
   */
  const admin = ctx.supabaseAdmin

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

      /*
       * Say what is wrong, not just that something was.
       *
       * This returned a flat "The email could not be sent." for a 502 and it cost
       * a whole debugging session, because the three causes look identical from the
       * outside and have nothing in common to fix:
       *
       *   403  the *sender* is not allowed to send to this recipient. Almost always
       *        `MAIL_FROM` being unset, which leaves the default below -- and
       *        `onboarding@resend.dev` is Resend's own test address, which may only
       *        ever send to the account that owns the key. Every real invitation is
       *        refused, and the refusal names neither the sender nor the reason.
       *   401  the API key is wrong or was revoked.
       *   422  the payload is wrong -- a `from` Resend will not parse, say.
       *
       * The share has already been written by the time this runs, so the person has
       * access either way and this is a notification about it. Which means the
       * message goes in the dialog, where the person sharing can act on it, and it
       * has to be the thing that is actually wrong rather than a shrug.
       */
      const resendName = (result as { name?: string } | null)?.name ?? ''
      const resendMessage = (result as { message?: string } | null)?.message ?? ''

      let error = 'The email could not be sent.'
      if (resendName === 'validation_error' || resendName.includes('domain')) {
        error =
          `The sending address is not set up: ${resendMessage || 'Resend refused the sender.'} ` +
          'Set MAIL_FROM to a verified address on this project.'
      } else if (resendName === 'missing_api_key' || resendName === 'invalid_api_key') {
        error = 'The email service rejected the API key. Check RESEND_API_KEY on this deployment.'
      } else if (resendMessage) {
        error = `The email could not be sent: ${resendMessage}`
      }

      return respond(request, { error }, 502)
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

// Map204 — tells someone a workspace has been shared with them.
//
// Why this is a function and not a request from the browser: the Resend key is a
// secret, and a secret in the browser is not a secret. The anon key is public by
// design, so nothing that can send mail may hang off it.
//
// The caller must be the signed-in person, and the function checks that *they*
// own or edit the workspace before it will name it in an email. Without that
// check this endpoint would be an open relay: anyone could ask it to mail a
// subject's content to any address they liked.

import { createClient } from 'jsr:@supabase/supabase-js@2'

import { ICON_LABELS, WORKSPACE_ACCENT_HEX } from './_workspace_look.ts'

const RESEND_URL = 'https://api.resend.com/emails'
/** Where the link points. Overridable so a preview deployment cannot send real mail. */
const APP_URL = Deno.env.get('APP_URL') ?? 'https://map204.vercel.app'
const FROM = Deno.env.get('MAIL_FROM') ?? 'Map204 <onboarding@resend.dev>'

/** Escape before interpolating anything into HTML. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The email body, built from the same tokens as the site so the two read as one
 * product. Inline styles only: email clients strip <style> blocks, and a
 * stylesheet that silently fails is how an email ends up as unstyled text.
 */
function renderEmail({ workspaceTitle, accent, iconLabel, sharerName, role, link }) {
  const roleText = role === 'viewer' ? 'can look but not change' : 'can edit'

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
      <tr>
        <td style="padding:28px 32px 8px;">
          <div style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:#111827;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(accent)};margin-right:8px;vertical-align:middle;"></span>
            Map204
          </div>
        </td>
      </tr>

      <tr>
        <td style="padding:16px 32px 0;">
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:700;color:#111827;">
            ${esc(sharerName)} shared a workspace with you
          </h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4b5563;">
            <strong style="color:#111827;">${esc(workspaceTitle)}</strong>
            <span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:#f3f4f6;color:#6b7280;font-size:12px;">${esc(iconLabel)}</span>
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
              <td style="background:${esc(accent)};border-radius:10px;">
                <a href="${esc(link)}" style="display:inline-block;padding:11px 20px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                  Open the workspace
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#6b7280;">
            You can ${esc(roleText)}. Nothing is visible to anyone else you have not invited.
          </p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#9ca3af;">
            If the button does not work, paste this into your browser:<br>
            <span style="word-break:break-all;">${esc(link)}</span>
          </p>
        </td>
      </tr>

      <tr>
        <td style="padding:24px 32px 28px;border-top:1px solid #f3f4f6;margin-top:24px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
            You are receiving this because ${esc(sharerName)} added your account to a workspace on Map204.
            If you were not expecting it, you can ignore this email — the workspace owner can remove you at any time.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const authHeader = request.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) {
    return Response.json({ error: 'Mail is not configured on this deployment.' }, { status: 503 })
  }

  let payload
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'Malformed request.' }, { status: 400 })
  }

  const { documentId, to } = payload ?? {}
  if (!documentId || !to) {
    return Response.json({ error: 'documentId and to are required.' }, { status: 400 })
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 })
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
    return Response.json({ error: 'That workspace does not exist.' }, { status: 404 })
  }

  // Ownership is `documents.owner_id`, *not* a row in document_collaborators.
  // The schema has a helper called `add_document_owner`, but nothing calls it —
  // no trigger is wired to it — so the owner has no collaborator row to join
  // against. Checking the owner first is what makes this work for the person
  // who actually shares; the collaborator lookup only covers the editors they
  // have since invited.
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
    return Response.json(
      { error: 'Only the owner of a workspace can share it.' },
      { status: 403 },
    )
  }

  // The colour and label the recipient will see come from the same tables the
  // app uses, so the email cannot describe a workspace differently from the
  // workspace itself.
  const accent = WORKSPACE_ACCENT_HEX[doc.accent as string] ?? WORKSPACE_ACCENT_HEX.indigo
  const iconLabel = ICON_LABELS[doc.icon as string] ?? 'General'

  const sharerName = me.user_metadata?.name ?? me.user_metadata?.full_name ?? me.email ?? 'Someone'
  const role = payload.role === 'viewer' ? 'viewer' : 'editor'
  const link = `${APP_URL}/w/${encodeURIComponent(documentId)}`

  const response = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: `${sharerName} shared "${doc.title}" with you`,
      html: renderEmail({
        workspaceTitle: doc.title,
        accent,
        iconLabel,
        sharerName,
        role,
        link,
      }),
    }),
  })

  const result = await response.json()
  if (!response.ok) {
    console.error('[send-share-email] resend refused:', response.status, result)
    return Response.json({ error: 'The email could not be sent.' }, { status: 502 })
  }

  return Response.json({ ok: true, id: result?.id ?? null })
})

// The share email, as a template.
//
// Extracted from `index.ts` so the thing somebody will want to change -- the words,
// the layout, the colour -- is a file you can find without reading an authorisation
// boundary to find it. `index.ts` now does two jobs that have nothing to do with
// each other: decide *whether* an email may be sent, and hand the details to here.
//
// ## Plain HTML on purpose
//
// Inline styles only, and a table-based layout. Email clients strip `<style>`
// blocks, and a stylesheet that silently fails is how an email arrives as a wall of
// unstyled text. This is what the file looked like before it moved, and it did not
// get worse on the way.
//
// ## Every interpolation goes through `esc`
//
// The subject, the workspace title, the sharer's name and the recipient's address are
// all attacker-influenced in one sense or another -- a workspace title is whatever
// somebody typed. Interpolating any of them raw is HTML injection into an email that
// lands in somebody's inbox.

/** Escape before interpolating anything into HTML. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface EmailDetails {
  workspaceTitle: string
  /** The workspace's accent colour, as a hex string from the app's own table. */
  accent: string
  /** The icon's name, spelled out. An unrecognised token would render as nothing. */
  iconLabel: string
  sharerName: string
  role: 'editor' | 'viewer'
  link: string
  /**
   * Whether the recipient already has an account.
   *
   * This is not decoration -- it changes the heading, the button, the explanation and
   * the subject. An address with no account gets "Create your account", because
   * linking somebody straight to a workspace they cannot open is the single most
   * useless thing an invitation can do.
   */
  hasAccount: boolean
  /** The address the invitation was sent to, lower-cased. Shown so they can check. */
  invitedEmail: string
}

/** The subject line, kept beside the body so the two cannot describe different things. */
export function subjectFor(details: Pick<EmailDetails, 'sharerName' | 'workspaceTitle' | 'hasAccount'>): string {
  return details.hasAccount
    ? `${details.sharerName} shared "${details.workspaceTitle}" with you`
    : `${details.sharerName} invited you to Map204`
}

/**
 * The message body.
 *
 * Both shapes come out of the same layout so the invitation and the share look like
 * one product, and only the parts that are actually different differ.
 */
export function renderEmail(details: EmailDetails): string {
  const { workspaceTitle, accent, iconLabel, sharerName, role, link, hasAccount, invitedEmail } =
    details
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
            ${hasAccount
              ? `${esc(sharerName)} shared a workspace with you`
              : `${esc(sharerName)} invited you to Map204`}
          </h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4b5563;">
            <strong style="color:#111827;">${esc(workspaceTitle)}</strong>
            <span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:#f3f4f6;color:#6b7280;font-size:12px;">${esc(iconLabel)}</span>
          </p>
${
  hasAccount
    ? ''
    : `          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4b5563;">
            Make an account with <strong style="color:#111827;">${esc(invitedEmail)}</strong> and this
            workspace is already waiting for you. The invitation is saved against the
            address rather than held in a link, so it works even if this email does not.
          </p>
`
}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
              <td style="background:${esc(accent)};border-radius:10px;">
                <a href="${esc(link)}" style="display:inline-block;padding:11px 20px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                  ${hasAccount ? 'Open the workspace' : 'Create your account'}
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
            You are receiving this because ${esc(sharerName)} added ${hasAccount ? 'your account' : 'this address'} to a workspace on Map204.
            If you were not expecting it, you can ignore this email &mdash; the workspace owner can remove you at any time.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

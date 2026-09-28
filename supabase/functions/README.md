# Share emails

When you invite somebody to a workspace, Map204 emails them a link to it.

## Why a function

The browser cannot send mail, and the Supabase anon key is public by design — so
anything that sends mail has to run somewhere the key is not. That is
`supabase/functions/send-share-email`, an Edge Function that calls Resend's HTTP
API with a key held as a server-side secret.

The function is also the authorisation boundary. It re-checks that the caller is
signed in **and** is the owner or an editor of that workspace, using the service
role key, before it will name the workspace in an email. Without that check the
endpoint would be an open relay: anyone signed in could ask it to mail the
contents of any workspace they had been lent, to any address.

A failed email never undoes the invite. The grant is written to
`document_collaborators` first; the mail is a notification afterwards, and the
share dialog says so plainly if it does not go out.

## One-time setup

1. Create an account at [resend.com](https://resend.com) and verify your domain.
2. Get an API key (starts with `re_`).
3. Install the Supabase CLI, then:

```powershell
supabase secrets set RESEND_API_KEY=re_... --project-ref ofpbdzqnszupgtjkncgv
```

4. Deploy the function:

```powershell
supabase functions deploy send-share-email --project-ref ofpbdzqnszupgtjkncgv
```

Without step 3–4 the app still shares normally; only the email is skipped, and
the dialog says the person has access but the mail did not send.

## Optional secrets

| Secret | Default | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | — | Required. The Resend API key. |
| `MAIL_FROM` | `Map204 <onboarding@resend.dev>` | The From header. Resend's default only allows sending to your own address until a domain is verified. |
| `APP_URL` | `https://map204.vercel.app` | The link in the email. Set this on a preview deployment so a test share cannot point at production. |

## Local development

```powershell
supabase functions serve send-share-email --env-file supabase/functions/.env.local
```

`supabase/functions/.env.local` is git-ignored and should hold the three values
above for local runs.

## Keeping the three lists in step

A workspace's colour and icon are enumerated in three places — the app
(`src/theme.ts`), the database (`documents_accent_check` and
`documents_icon_check` in migration `…90800`), and the email
(`supabase/functions/send-share-email/_workspace_look.ts`). An Edge Function is
bundled separately and cannot import from `src/`, so the duplication is
unavoidable.

`npm run test:workspace-look` compares all three, including the exact hex values
and the icon labels, and fails the build if they disagree. It also checks that
every icon the app offers is one `WorkspaceMark` can actually draw — an id with
no component behind it renders as an empty box.

Run it after adding a colour or an icon. You will need to update the migration
too; because migrations must not be rewritten once applied, that means a new
migration that drops and re-adds the constraint.

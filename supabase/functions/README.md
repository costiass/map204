# Share emails

When you invite somebody to a workspace, Map204 emails them a link to it — or, if
they have no account yet, an invitation to make one.

## Where things are

| | |
|---|---|
| The function | `supabase/functions/send-share-email/index.ts` |
| **The email template** | `supabase/functions/send-share-email/email-template.ts` |
| Function configuration | `supabase/functions/send-share-email/config.toml` |
| Secret names | `supabase/functions/.env.example` |

The words, the layout and the colour are all in `email-template.ts`. You do not need
to read the authorisation code to change what the email says.

There are two emails, chosen by whether the recipient already has an account:

* **They have one** — “X shared a workspace with you”, linking straight to the map.
* **They do not** — “X invited you to Map204”, linking to sign-up, and explaining that
  the workspace is already saved against their address.

## Why a function

The browser cannot send mail, and the Supabase anon key is public by design — so
anything that sends mail has to run somewhere the key is not. This is an Edge
Function that calls Resend's HTTP API with a key held as a server-side secret.

The function is also the authorisation boundary. It re-checks that the caller is
signed in **and** is the owner or an editor of that workspace, using the service role
key, before it will name the workspace in an email. Without that check the endpoint
would be an open relay: anyone signed in could ask it to mail the contents of any
workspace they had been lent, to any address.

A failed email never undoes the share. The grant is written first — to
`document_collaborators`, or to `document_invites` when the recipient has no account
yet — and the mail is a notification afterwards. The dialog says so plainly if it
does not go out.

## One-time setup

1. Create an account at [resend.com](https://resend.com) and verify your domain.
2. Get an API key (starts with `re_`).
3. Install the Supabase CLI, then:

```powershell
supabase secrets set RESEND_API_KEY=re_... --project-ref ofpbdzqnszupgtjkncgv
```

4. Add `APP_URL` as a repository **variable** (Settings → Secrets and variables →
   Actions → Variables) with the value `https://map204.vercel.app`, and
   `SUPABASE_PROJECT_REF` as a **secret**. The migration workflow already needs the
   latter, so it is probably there.

## Deploying a change to a function

**Edge functions are not part of the migration workflow.** `supabase db push`
applies schema; it does not touch functions. And `deploy.yml` matches
`supabase/**`, so a commit that changes a function *does* run — it rebuilds and
redeploys the frontend, and the green tick means the frontend shipped while the
function stayed exactly as it was.

That is not hypothetical. It is how the CORS fix below took three attempts to
reach you: the fix was correct in the repository and correct in the local edge
runtime, and the deployed copy answered `405` the whole time.

`supabase-functions.yml` deploys on any push touching `supabase/functions/**` and
then asks the live URL the question a browser asks first. It fails the run on a
`405`, and on an `access-control-allow-origin` that is not the app's own — a
wildcard included, since a function that sends mail is an open relay if every
origin may use it.

To deploy by hand:

```powershell
supabase functions deploy send-share-email --project-ref ofpbdzqnszupgtjkncgv
```

Without the deploy step the app still shares normally; only the email is skipped,
and the dialog says the person has access but the mail did not send.

### Checking it is deployed

```powershell
curl.exe -i -X OPTIONS -H "Origin: https://map204.vercel.app" `
  -H "Access-Control-Request-Method: POST" `
  https://ofpbdzqnszupgtjkncgv.supabase.co/functions/v1/send-share-email
```

You want `HTTP/1.1 204` and an `access-control-allow-origin` of
`https://map204.vercel.app`.

A `405`, or a `204` with no allow-origin header, means the deployed copy is older
than `config.toml` and `index.ts` here — redeploy. That was the state this function
was in: it answered the browser's preflight with `405 Method not allowed` and no
response carried `Access-Control-Allow-Origin`, so **every email failed with a CORS
error** while the share itself worked. The message in the console named neither the
cause nor the function, which is why it looked like an OAuth problem.

### Running it locally

```powershell
supabase functions serve send-share-email --env-file .env.local
```

## CORS

Three things, and all three have to be true or the browser refuses every response:

1. **`OPTIONS` is answered with 204 and a null body.** A browser sends a preflight
   whenever a request is not “simple”, and one carrying `Authorization` and a JSON
   content type never is. Deno throws on a 204 *with* a body — even an empty string —
   so the preflight sends `null`.
2. **Every response carries the headers**, including the error paths. An error the
   browser cannot read is indistinguishable from the function being down, which is
   how the above hid.
3. **The origin is allow-listed**, not reflected. This function sends mail: anyone who
   can make it send can put mail in any inbox. `ALLOWED_ORIGINS` in `index.ts` holds
   the list; an unlisted origin gets no allow-origin at all, and `Vary: Origin`
   stops a shared cache serving one origin's response to another.

`config.toml` sets `verify_jwt = false`, because the gateway otherwise checks the
JWT before the function runs and a preflight has none to check. That is not a hole:
the function authenticates every request itself and then checks that the caller
*owns* that workspace, which is a stronger test than the gateway's.

## Tests

| | |
|---|---|
| `npm run test:share-email` | the source: preflight, headers, allow-list, auth, template |
| `npm run test:share-email-guard` | breaks each of those in turn and expects a failure |
| `npm run test:share-email-live` | **runs the function** in Supabase's edge runtime and makes real requests |

The live one is the one that earns its place. Every source-level check passed while
the preflight was still broken, because the bug was `new Response('', {status: 204})`
— correct-looking, and a runtime error in Deno:

```
TypeError: Response with null body status cannot have body
```

It skips cleanly where Docker or the edge-runtime image is absent.

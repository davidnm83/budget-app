# Security

How this app keeps keys and data safe, and what you need to do when you host it yourself.

## Where secrets live

| Secret | Where it goes | Never put it in |
| --- | --- | --- |
| Supabase URL and publishable key | `apps/app/.env` (shipped in the app; safe because of row-level security) | — |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `CRON_SECRET` | `supabase/.env`, uploaded with `npx supabase secrets set --env-file supabase/.env` | `apps/app/.env`, the repo |
| Supabase secret (service-role) key | Provided to Edge Functions by Supabase; you never copy it | Anywhere in the app or repo |
| Bank access tokens | Supabase Vault (encrypted), written and read only by Edge Functions | The browser never receives them |

`.env` files are git-ignored. `supabase/setup/cron.sql` is committed with placeholders only: paste it into
the SQL Editor and fill it in there. Do not save the filled-in copy back to the repo.

## How data is protected

- Every table has row-level security: a signed-in user can only read and write their own rows.
- Bank connections (`plaid_items`) and sync history are read-only for users; only Edge Functions change them.
- Signed-out visitors have no access to any table.
- The functions that store, read and delete bank tokens can only be called with the secret key.
- Edge Functions check the caller's sign-in token themselves; the daily sync also accepts the cron secret.
- Demo accounts (`app_metadata.demo = true`) cannot link banks, in the app or by calling the functions directly.

## Settings to check in the Supabase dashboard

- Authentication > Sign In / Providers: turn off "Allow new users to sign up" and add users yourself.
- Authentication > Attack Protection: turn on leaked-password protection if your plan has it (not on the free tier).
- Use a long unique password. Anyone with it can read your finances.

## Known limits

- Edge Functions answer any website (`Access-Control-Allow-Origin: *`). They still require a valid sign-in token.
- Error messages from Plaid and the database are passed to the signed-in user as-is.
- Merchant and bank logos are fetched from DuckDuckGo's icon service by site name. Turn this off in Settings.
- `npm audit` reports issues in Expo's build tools (node-forge, uuid). They run at build time and are not shipped in the app.

## Reporting a problem

Open a private security advisory on the GitHub repository.

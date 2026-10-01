# Self-hosting budget-app

Each person runs their **own copy**: their own Supabase project (database + server functions) and their own Plaid account. Nobody else's keys or bank data are involved. Setup takes about 30–45 minutes. Everything here fits in free tiers.

## What you need

- **[Node.js](https://nodejs.org) 20 or newer** and **[Git](https://git-scm.com)**
- **A GitHub account**, to fork this repo
- **A [Supabase](https://supabase.com) account** (free)
- **A [Plaid](https://dashboard.plaid.com/signup) account on the free Trial plan**, which covers up to 10 bank logins and needs identity verification. The Trial plan uses Plaid's **production** environment, so use your **Production** secret.

## 1. Get the code

```bash
git clone https://github.com/<you>/budget-app.git   # your fork
cd budget-app
npm install
```

## 2. Create your Supabase project

1. In Supabase, create a **New project**. Pick a region near you (e.g. Canada Central) and save the database password somewhere safe.
2. Note the **project ref**, the `abcdefgh…` part of `https://abcdefgh….supabase.co`.
3. Connect this repo to it and create the tables:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

This creates the tables, the row-level security rules (each user only sees their own data) and starter categories for every new user.

## 3. Add your secrets

Make a long random string for the daily job:

```bash
openssl rand -hex 32   # copy the output; it's your CRON_SECRET
```

Then store your Plaid keys and settings as Edge Function secrets. They stay on the server; the app never sees them.

```bash
npx supabase secrets set \
  PLAID_CLIENT_ID=<from Plaid Dashboard > Developers > Keys> \
  PLAID_SECRET=<your Production secret> \
  PLAID_ENV=production \
  PLAID_COUNTRY_CODES=CA,US \
  APP_TIMEZONE=America/Toronto \
  CRON_SECRET=<the random string>
```

To try everything with fake banks first, use `PLAID_ENV=sandbox` with your Sandbox secret. In Link, sign in as `user_good` with password `pass_good`.

## 4. Deploy the server functions

```bash
npx supabase functions deploy
```

This deploys `plaid-link-token`, `plaid-exchange`, `plaid-sync` and `plaid-remove`.

## 5. Turn on the daily 5 AM sync

1. Open `supabase/setup/cron.sql` and replace the two placeholders:
   - your project URL
   - the same `CRON_SECRET`
2. Paste it into Supabase → **SQL Editor** and run it **once**.

The job fires at 09:00 and 10:00 UTC. The function only does the work in the run that lands at 5 AM in `APP_TIMEZONE`, so it stays 5 AM through daylight-saving changes.

## 6. Lock down sign-ups (important)

The app's publishable key is public by design. After you create **your** account in step 7, turn off new sign-ups: Supabase → **Authentication → Sign In / Providers** → disable **Allow new users to sign up**. Otherwise anyone who finds your app URL could create an account on your instance. They still couldn't see your data, but they could use your Plaid connections quota.

## 7. Run the app

```bash
cp .env.example apps/app/.env
```

Edit `apps/app/.env` and fill in two values from Supabase → **Project Settings → API Keys**:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (older projects: the "anon" key)

Then start it:

```bash
npm run web
```

Create your account, then go to **Settings → Link a bank**.

## 8. Put it on your phone

**Easiest: host the web app.** It's free on Vercel, Netlify or Cloudflare Pages. Then on your phone, open the URL and choose **Add to Home Screen**.

- **Vercel:** import your fork, set the **Root Directory** to `apps/app`, and add the two `EXPO_PUBLIC_…` variables. `apps/app/vercel.json` already has the build settings.
- **Other hosts:** build command `npx expo export --platform web`, output folder `dist`, and send every path to `index.html`.

**Native iPhone/Android app (optional).** Plaid's native SDK needs a *development build*; it won't run in Expo Go.

```bash
cd apps/app
npx expo run:ios       # needs a Mac with Xcode
npx expo run:android   # needs Android Studio
# or build in the cloud: npx eas-cli@latest build --profile development
```

Change `ios.bundleIdentifier` / `android.package` in `apps/app/app.json` from `com.example.budgetapp` to something of your own first.

## Updating

```bash
git pull upstream main       # or sync your fork on GitHub
npm install
npx supabase db push         # new tables or columns
npx supabase functions deploy
```

## Troubleshooting

- **"Sign in first."** from a function: your session expired. Sign out and back in.
- **A bank shows "Needs you to sign in again".** Tap **Fix** in Settings and sign in to the bank.
- **No transactions right after linking.** Plaid can take a few minutes to gather history. Tap **Sync now** on the Accounts tab a little later.
- **Daily sync isn't running.** In the SQL Editor run `select * from cron.job_run_details order by start_time desc limit 5;`.
- **Function errors.** See Supabase → **Edge Functions → plaid-sync → Logs**.
- **Banks that use OAuth on the web** (they send you to the bank's own site) may need a redirect URI. Register it in the Plaid Dashboard and set `PLAID_REDIRECT_URI`. This isn't handled yet.

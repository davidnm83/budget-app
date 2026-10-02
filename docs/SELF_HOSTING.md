# Self-hosting budget-app

Each person runs their **own copy**: their own Supabase project (database + server functions) and their own Plaid account. Nobody else's keys or bank data are involved. Setup takes about 30–45 minutes. Everything here fits in free tiers.

## What you need

- **[Node.js](https://nodejs.org) 20 or newer** and **[Git](https://git-scm.com)**
- **A GitHub account**, to fork this repo
- **A [Supabase](https://supabase.com) account** (free)
- **Optional: a [Plaid](https://dashboard.plaid.com/signup) account on the free Trial plan**, which covers up to 10 bank logins and needs identity verification. The Trial plan uses Plaid's **production** environment, so use your **Production** secret. Skip it if you only want to import files or add accounts by hand; steps 3 to 5 are then not needed.

## Where do I type these commands?

**Not on the Supabase website.** The `npx supabase …`, `npm …` and `git …` commands run in a **terminal on your own computer**, inside the project folder. `npx supabase` downloads the Supabase command-line tool the first time; answer `y` if it asks.

The Supabase website is only used for:

- creating the project
- copying keys (Project Settings)
- the **SQL Editor** (step 5)
- **Authentication** settings (step 6)
- **Edge Function logs**

**On Windows:**

1. In File Explorer, open the project folder (e.g. `C:\Projects\budget-app`).
2. Right-click an empty spot and choose **Open in Terminal**. This opens PowerShell already in the right folder. You can also use **Terminal → New Terminal** in VS Code.
3. Check Node.js is installed: `node -v`. If it says "not recognized", install it with `winget install OpenJS.NodeJS.LTS`, then close and reopen the terminal.

PowerShell differs from the Mac/Linux examples below in two ways:

- **Line continuation:** a command split over several lines uses a backtick `` ` `` at the end of each line instead of `\`. Or just put it on one line.
- **Copying files:** use `copy` instead of `cp`, with backslashes in paths.
- **No `openssl` command:** generate the random secret in step 3 with:
  ```powershell
  $b = New-Object byte[] 32; [Security.Cryptography.RNGCryptoServiceProvider]::new().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
  ```

If you connected your Supabase project to GitHub in the dashboard, that's fine to leave on. This guide uses the command line, which works either way.

## 1. Get the code

```bash
git clone https://github.com/<you>/budget-app.git   # your fork
cd budget-app
npm install
```

## 2. Create your Supabase project

1. In Supabase, create a **New project**. Pick a region near you and save the database password somewhere safe.
2. Note the **project ref**, the `abcdefgh…` part of `https://abcdefgh….supabase.co`.
3. Connect this repo to it and create the tables:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push        # asks for the database password from step 2
```

This creates the tables, the row-level security rules (each user only sees their own data) and starter categories for every new user.

## 3. Add your secrets

Make a long random string for the daily job:

```bash
openssl rand -hex 32   # copy the output; it's your CRON_SECRET
```

Then store your Plaid keys and settings as Edge Function secrets. They stay on the server; the app never sees them.

1. Copy `supabase/.env.example` to `supabase/.env` (Windows: `copy supabase\.env.example supabase\.env`).
2. Fill in your Plaid client ID, Production secret and the random `CRON_SECRET`. Set `PLAID_COUNTRY_CODES`, `APP_TIMEZONE` and `DEFAULT_CURRENCY` for where you live.
3. Upload them:

```bash
npx supabase secrets set --env-file supabase/.env
```

`supabase/.env` is git-ignored. Keep these values out of `apps/app/.env`.

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

The job fires every hour. The function only does the work in the run that lands at 5 AM in `APP_TIMEZONE` (set it in `supabase/.env`; the default is UTC), so it stays 5 AM through daylight-saving changes.

## 6. Lock down sign-ups (important)

The app's publishable key is public by design. After you create **your** account in step 7, turn off new sign-ups: Supabase → **Authentication → Sign In / Providers** → disable **Allow new users to sign up**. Otherwise anyone who finds your app URL could create an account on your instance. They still couldn't see your data, but they could use your Plaid connections quota.

## 7. Run the app

```bash
cp apps/app/.env.example apps/app/.env      # Windows: copy apps\app\.env.example apps\app\.env
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

- **`Cannot find module 'expo-router/…'` or other odd errors when starting the app.** The installed packages don't match `package-lock.json`, which can happen if something ran `npm install <package>` or edited `apps/app/package.json`. Reset to the committed versions and reinstall:
  ```bash
  git restore apps/app/package.json package-lock.json
  # delete node_modules and apps/app/node_modules, then:
  npm ci
  ```
  Add app packages with `npx expo install <package>` from `apps/app`, which picks versions that match the Expo SDK.

- **"Sign in first."** from a function: your session expired. Sign out and back in.
- **A bank shows "Needs you to sign in again".** Tap **Fix** in Settings and sign in to the bank.
- **No transactions right after linking.** Plaid can take a few minutes to gather history. Tap **Sync now** on the Accounts tab a little later.
- **Daily sync isn't running.** In the SQL Editor run `select * from cron.job_run_details order by start_time desc limit 5;`.
- **Function errors.** See Supabase → **Edge Functions → plaid-sync → Logs**.
- **Banks that use OAuth on the web** (they send you to the bank's own site) may need a redirect URI. Register it in the Plaid Dashboard and set `PLAID_REDIRECT_URI`. This isn't handled yet.

# app

The Expo (React Native) app for iPhone, Android and web. See the main [README](../../README.md) and [docs/SELF_HOSTING.md](../../docs/SELF_HOSTING.md).

```bash
cp .env.example .env         # fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm run web                  # web, in the browser
npm run ios / npm run android  # native development build (Plaid Link needs one; Expo Go won't work)
npm run typecheck
```

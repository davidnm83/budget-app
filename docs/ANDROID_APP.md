# The Android app (a Trusted Web Activity)

The app can be packaged as a real Android app (an `.apk`) with Google's [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap).
It is the same web app, shown full-screen by Chrome without an address bar, so it updates with every deploy and shares
Chrome's sign-in, offline copy and notifications. Nothing in the app changes. You only rebuild the `.apk` to change its
name, icon or colours.

You need Node.js. Bubblewrap downloads Java and the Android tools itself the first time.

**On Windows, three fixes first** (Bubblewrap 1.27):
- If your user name has a space in it, the Android tools fail to install. Move them somewhere without one and point
  Bubblewrap there: after `init` has downloaded them, move `%USERPROFILE%\.bubblewrap\jdk` and `android_sdk` to
  `C:\bubblewrap\` and change the two paths in `%USERPROFILE%\.bubblewrap\config.json` to match.
- Bubblewrap installs a 32-bit Java on Windows, which can't start the Android build ("Could not reserve enough space
  for ... object heap"). Download the 64-bit Temurin JDK 17 zip, unzip it to `C:\bubblewrap\jdk64` and run
  `npx @bubblewrap/cli updateConfig --jdkPath "C:\bubblewrap\jdk64\jdk-17.0.11+9"`.
- After `init`, set `"minSdkVersion": 24` in `twa-manifest.json` and run `npx @bubblewrap/cli update --skipVersionUpgrade`
  (the default, 21, is lower than the library Bubblewrap uses needs).

## 1. Create the project (once)

Keep it in its own folder, outside this repo:

```
mkdir budget-android
cd budget-android
npx @bubblewrap/cli init --manifest https://YOUR-SITE/manifest.webmanifest
```

Answers, where the default isn't right:

| Question | Answer |
| --- | --- |
| Install the JDK / Android SDK? | Yes (first time only) |
| Domain | Your site, exactly as it's served (no redirect to another host) |
| URL path | `/` |
| Application name / Short name | `Budget` |
| Application ID | The suggested one is fine. It can't change later without reinstalling the app. |
| Display mode | `standalone` |
| Status bar colour / Splash screen colour | `#F7F7F5` |
| Icon URL | `https://YOUR-SITE/icon-512.png` |
| Maskable icon URL | `https://YOUR-SITE/icon-maskable-512.png` |
| Monochrome icon URL | leave empty |
| Play Billing / geolocation | No |
| Key store location / alias | the defaults (`./android.keystore`, `android`) |
| Create a new key? | Yes. Write down both passwords. |

**Back up `android.keystore`, its passwords and `twa-manifest.json`** somewhere safe and never commit them. A later
build has to be signed with the same key, or Android won't install it over the old one.

## 2. Build

```
npx @bubblewrap/cli build
```

It asks for the two passwords and writes `app-release-signed.apk`.

## 3. Link the site to the app

Chrome only hides its address bar once the site says the app is its own. Make `assetlinks.json` from the signing key:
read the key's SHA-256 fingerprint (`keytool -list -v -keystore android.keystore -alias android`, using the `keytool`
in the JDK's `bin` folder), then

```
npx @bubblewrap/cli fingerprint add <the SHA256 value>
npx @bubblewrap/cli fingerprint generateAssetLinks
```

Copy that `assetlinks.json` to `apps/app/public/.well-known/assetlinks.json` in this repo, commit and deploy. It holds the app's ID and the public
fingerprint of its key, nothing secret. Check it's live: `https://YOUR-SITE/.well-known/assetlinks.json` should show
it, not the app.

## 4. Install

Copy `app-release-signed.apk` to the phone (Google Drive, email or USB), open it and allow installs from that app when
Android asks. With USB debugging on, `npx @bubblewrap/cli install` does it from the computer.

If an address bar shows at the top, the link isn't live yet: once it is, close the app fully and open it again (or
clear the app's storage in Android's settings). Remove the old installed web app so there aren't two.

## Changing it later

Edit `twa-manifest.json` (or run `npx @bubblewrap/cli update`, which also raises the version number), then build and
install again.

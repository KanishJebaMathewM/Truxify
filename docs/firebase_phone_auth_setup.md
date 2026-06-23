# Firebase Phone Authentication Setup Guide

This document describes how to set up Firebase Phone Authentication for the Truxify Customer and Driver Flutter apps.

## Prerequisites

- A Google account with access to the [Firebase Console](https://console.firebase.google.com)
- Flutter SDK installed
- Android SDK with API 23+ (minSdk is set to 23)

## 1. Firebase Project Setup

### Create or Select a Firebase Project

1. Go to the [Firebase Console](https://console.firebase.google.com)
2. Click **Add project** (or select your existing project, e.g., `truxify-auth-prod`)
3. Follow the setup wizard (you can disable Google Analytics if not needed)

### Enable Phone Authentication

1. In the Firebase Console, go to **Authentication** → **Sign-in method**
2. Click **Phone** and enable it
3. Click **Save**

## 2. Register Android Apps

You need to register **two** Android apps in your Firebase project:

### Customer App
- **Android package name**: `com.example.freightfair`
- **App nickname**: Truxify Customer (optional)

### Driver App
- **Android package name**: `com.example.truxify_driver`
- **App nickname**: Truxify Driver (optional)

### Steps for Each App

1. In the Firebase Console, click **Add app** → **Android**
2. Enter the package name (see above)
3. Download the `google-services.json` file
4. Place it in the correct directory:

```text
apps/customer/android/app/google-services.json   # Customer app
apps/driver/android/app/google-services.json      # Driver app
```

> **Important**: The `google-services.json` files contain project-specific configuration and should NOT be committed to version control if the repository is public. Add them to `.gitignore` if needed.

## 3. SHA Fingerprints (Required for Phone Auth)

Firebase Phone Authentication requires SHA-1 and SHA-256 fingerprints registered in the Firebase Console.

### Get Debug SHA-1 Fingerprint

```bash
# On Windows
cd apps/customer/android
.\gradlew.bat signingReport

# On macOS/Linux
cd apps/customer/android
./gradlew signingReport
```

Look for the `SHA1` and `SHA-256` values under `Variant: debug`.

### Register Fingerprints

1. In the Firebase Console, go to **Project settings** → **Your apps**
2. Select the Android app
3. Click **Add fingerprint**
4. Add both SHA-1 and SHA-256 fingerprints
5. Download the updated `google-services.json` and replace the old one

> Repeat for both Customer and Driver apps.

## 4. Test Phone Numbers (Development)

Firebase allows you to add test phone numbers that bypass real SMS delivery. This is useful for:
- Automated testing
- Development without consuming SMS quota
- CI/CD pipelines

### Setup Test Numbers

1. In the Firebase Console, go to **Authentication** → **Sign-in method** → **Phone**
2. Under **Phone numbers for testing**, add entries like:

| Phone Number    | Verification Code |
| --------------- | ----------------- |
| +91 9876543210  | 123456            |
| +91 1234567890  | 654321            |

> **Note**: Firebase Phone Auth uses **6-digit** verification codes, not 4-digit.

## 5. Backend Configuration

The backend already supports Firebase token verification. Ensure these environment variables are set:

```env
# Firebase Project ID
FIREBASE_PROJECT_ID=truxify-auth-prod

# Firebase Service Account JSON (for server-side token verification)
FIREBASE_SERVICE_ACCOUNT_JSON={"type": "service_account", "project_id": "truxify-auth-prod", ...}

# Firebase API Key (optional, for additional features)
FIREBASE_API_KEY=AIzaSyA-your-firebase-web-api-key
```

The backend `auth.js` middleware automatically detects Firebase vs Supabase tokens and routes verification accordingly. User profiles are resolved via the `firebase_uid` column in the `profiles` table.

## 6. Running the Apps

```bash
# Install dependencies
cd apps/customer && flutter pub get
cd apps/driver && flutter pub get

# Run customer app
cd apps/customer && flutter run

# Run driver app
cd apps/driver && flutter run
```

## 7. Authentication Flow

```text
User enters phone number (+91 XXXXXXXXXX)
        ↓
Firebase sends SMS with 6-digit code
        ↓
User enters OTP code
        ↓
Firebase verifies and signs in
        ↓
App obtains Firebase ID Token
        ↓
API requests include: Authorization: Bearer <firebase-id-token>
        ↓
Backend verifies token via Firebase Admin SDK
        ↓
Backend resolves user profile via firebase_uid
```

## 8. Troubleshooting

### "Firebase Auth verification is not configured on this server"
- Ensure `FIREBASE_SERVICE_ACCOUNT_JSON` is set in the backend `.env`
- Verify the service account JSON is valid and has the correct project ID

### OTP not received
- Check that Phone Auth is enabled in Firebase Console
- Verify SHA fingerprints are registered
- Ensure the device has a valid SIM card and network connectivity
- For development, use test phone numbers (see Section 4)

### "User profile not found in database"
- The user's `firebase_uid` must exist in the `profiles` table
- Create a profile entry with the user's Firebase UID after first sign-in

### Build errors on Android
- Verify `google-services.json` is in `android/app/` directory
- Ensure `minSdk` is set to 23 or higher
- Run `flutter clean && flutter pub get` and rebuild

### "Failed to initialize reCAPTCHA Enterprise config. Triggering the reCAPTCHA v2 verification."
- **Why it happens**: This is a standard fallback warning printed by the Firebase Auth SDK when reCAPTCHA Enterprise is not set up in the Firebase project settings.
- **How to resolve**:
  1. **For Development**: Use **test phone numbers** (configured in Firebase Console -> Authentication -> Settings -> User Actions -> Test Phone Numbers). Test phone numbers bypass all reCAPTCHA/app verification checks completely.
  2. **For Production**: Enable the **Play Integrity API** (Android) or configure **reCAPTCHA Enterprise** in your Google Cloud / Firebase Console. Registering your debug and release SHA-256 fingerprints in the Firebase Console is also required for silent device verification.


## 9. iOS Setup (Future)

iOS support requires additional configuration:
1. Download `GoogleService-Info.plist` from Firebase Console
2. Add it to `ios/Runner/` via Xcode
3. Enable push notifications capability
4. Configure APNs for SMS delivery on iOS

This is planned for a future update.

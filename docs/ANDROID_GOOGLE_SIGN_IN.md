# Android Google identity

This optional native sign-in uses the official Flutter Google Sign-In 6.3.0 plugin (compatible with the Flutter 3.29 build). Firebase is initialized using the existing build-time API key and registered Android identifiers. The OAuth server client ID is the client_type 3 identifier in the newly downloaded Firebase Android configuration. No OAuth client secret, signing key, API key value or google-services.json file is committed.

The release SHA-1 must be registered in Firebase. Configure the existing GitHub Actions secret NASQO_FIREBASE_API_KEY from the current official config if it has not been configured. The debug signing certificate is different; the signed preview is the device acceptance target.

Open the native account icon in the app toolbar, choose Google sign-in, and verify the Firebase user in the console. Cancellation and sign-in failure must not block SQLite. Sign-out clears Firebase and the Google plugin session. No Drive access is requested. This is identity only; it does not enroll a workspace or start the still-disabled cloud sync. Do not enable financial replication until backend and tenant enrollment tests pass.

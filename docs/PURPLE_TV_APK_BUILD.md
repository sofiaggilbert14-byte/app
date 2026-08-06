# CharmIPTV Purple TV APK

Built locally from `main` @ `8f7686d` (includes PR #21 polish + CI fixes #25/#27).

## Artifact
- File: `CharmIPTV-Purple-TV-Universal.apk`
- Produced with: `./android/gradlew -p android assembleRelease`
- Architectures: `armeabi-v7a`, `arm64-v8a`
- Signed with the project debug keystore (same as CI release config)

## Install on Fire TV / Android TV
1. Download the APK from the cloud agent artifacts for this run
2. Sideload via ADB: `adb install -r CharmIPTV-Purple-TV-Universal.apk`

## What’s in this build
- Guide rapid-surf focus fixes (no rightward drift / dual Up-escape)
- Cold-start focus on Live TV nav
- Yellow reminder bells + Cancel reminder
- Empty-state retries, hierarchical BACK, player Retry focus

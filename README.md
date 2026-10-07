# Lanmora

Lanmora is an experimental offline Android messenger for phones connected to the same local Wi‑Fi network or hotspot.

## What is already in v0.1

- English, Ukrainian, Russian and Polish UI.
- Android `minSdk 23` (Android 6.0) and `targetSdk 37` (Android 17).
- Discovery of nearby Lanmora devices with Android NSD/mDNS.
- Direct text messages over TCP — no cloud server.
- Photo transfer.
- Voice notes recorded as AAC/M4A.
- Circular video notes recorded with CameraX.
- Basic one-to-one voice calls over UDP PCM.
- Local SQLite message history.
- Familiar messenger-style navigation: Chats / Contacts / Settings / Profile.
- GitHub Actions workflow that builds an installable debug APK.

## Important MVP limitations

This is a clean-room new app inspired by the *functionality* of offline messengers. It does **not** contain Talkie Pro source code and it is **not yet protocol-compatible with Talkie 3.1.0**.

Current v0.1 is an engineering MVP:

1. Both phones must be on the same Wi‑Fi network/hotspot.
2. The app should remain open during discovery, messaging and calls.
3. Voice calling is raw 16 kHz PCM over UDP. It is suitable for LAN testing but still needs jitter buffering, packet loss handling and a foreground call service.
4. Message/media transport is not end-to-end encrypted yet. Do not use this build for sensitive communication.
5. Groups, replies, forwarding, reactions, pinning, unread counters and background notifications are next-stage features.
6. Video notes use a circular preview and circular chat display, but the UX can still be refined.

## Build on GitHub

Create an empty GitHub repository and upload the contents of this folder, or use Git:

```bash
git init
git add .
git commit -m "Initial Lanmora MVP"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/lanmora.git
git push -u origin main
```

Then open **Actions → Build Android APK → Run workflow**.

After the workflow completes, open the run and download the artifact named `lanmora-debug-apk`. Inside it is `app-debug.apk`.

## Build locally

Use Android Studio with Android SDK 37 installed, JDK 17 and Gradle 9.4.1. Sync the project and run the `app` configuration.

## Android local-network permissions

The manifest includes:

- `NEARBY_WIFI_DEVICES` for Android 13+.
- `ACCESS_LOCAL_NETWORK` for Android 17+.
- `ACCESS_FINE_LOCATION` only up to Android 12 for older Wi‑Fi compatibility.
- `RECORD_AUDIO` and `CAMERA` for voice messages, calls and video notes.

## Recommended next milestones

### v0.2
- Foreground service for background reception/calls.
- Notifications and unread counters.
- Group chats.
- Reply / forward / delete / copy.
- File/document attachments.
- Delivery/read states.

### v0.3
- End-to-end encryption with authenticated device pairing.
- Better call codec (Opus), jitter buffer and packet-loss handling.
- QR pairing.
- Wi‑Fi Direct / LocalOnlyHotspot onboarding.
- Optional compatibility layer for the original Talkie protocol after protocol analysis.

## Product identity

`Lanmora` is a provisional project name. Before public distribution, perform a proper trademark/name check and replace the package/name if needed.

# Push notifications

## What sends a push

| Event | Title | Body | Opens |
| --- | --- | --- | --- |
| Like or repost | "Asha liked your post" | Your post's text | The post |
| Reply, mention or quote | "Asha replied" | Their text | The post |
| New follower | "Asha followed you" | @handle | Their profile |
| Follow request | "Asha wants to follow you" | Review the request | Follow requests |
| Direct message | Sender (in a group: "Asha in Group name") | The message, or "Sent you a message" if previews are off | The conversation |
| Message request | New message request | "Asha wants to send you a message". The text is never shown, because the sender isn't someone you follow. | The conversation |

### Rules

- **Repeats:** likes and reposts push at most once per post every 10 minutes, and follows once per person in that time. Message requests also push once per conversation in that time.
- **Undone actions:** a like or follow undone within about 1.5 seconds never pushes.
- **Muted and blocked accounts:** these never push, and neither do suspended or deleted accounts on either side.
- **Settings:** each person chooses in **Settings → Notifications**: a master switch, per-type switches, and message previews.
- **Badge:** the app icon badge shows unread notifications plus conversations with unread messages.
- **Signing out:** the device stops receiving pushes when the person logs out, signs out everywhere, deletes the account, or their session expires.

## How it works

1. Posting, liking, following and messaging each write a row to `push_outbox` in the same database transaction as the action itself, but only for recipients who have a device registered.
2. A worker inside the API (`apps/api/src/services/push.ts`) claims settled rows every 2 seconds. It checks whether each action still exists and whether the recipient's settings allow a push, then writes the lock-screen text. It sends through Expo's push service, which forwards to Apple (APNs) or Google (FCM).
3. Expo reports uninstalled apps immediately or about 15 minutes later. Those device tokens are deleted.

Several API servers can run the worker together without sending duplicates.

Delivery is *at most once*: a server crash mid-send can drop a push, but will never send it twice.

### Configuration (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUSH_PROVIDER` | `expo` | `off` disables sending |
| `EXPO_ACCESS_TOKEN` | none | Only needed if "Enhanced push security" is on for the Expo project |
| `PUSH_POLL_MS` | `2000` | How often the outbox is checked |
| `PUSH_SETTLE_MS` | `1500` | Grace period before sending, so quick undos don't push |

## Turning it on for real devices

Pushes can't be received in the iOS Simulator through Expo, or in a web browser. Everything else (settings, the Activity prompt, the server) works there.

1. **Create a free Expo account**, then link the app to an EAS project:
   ```bash
   cd apps/mobile
   npx eas-cli login
   npx eas-cli init
   ```
   This writes the project ID into `app.json`. Without it, the app shows a developer note in Settings → Notifications and registers no device.
2. **iOS** needs a paid Apple Developer account. The first `eas build` offers to create the push key (APNs) automatically; say yes.
3. **Android** needs a Firebase project. Upload its FCM V1 service-account key with `eas credentials`.
4. **Install a development or TestFlight build on a real phone.** Open Activity, tap **Turn on notifications**, then like one of that account's posts from another account.

## Tests

- `apps/api/test/push.test.ts` covers delivery, repeat suppression, undo, settings, message previews and requests, uninstalled devices, sign-out, and shared devices.
- In tests, a `RecordingPushSender` stands in for Expo, so no network is used.

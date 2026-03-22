# Chrome Web Store Form Answers (Copy/Paste)

## Single purpose

Gmail Unsubscriber Ondevice helps users clean up Gmail inboxes faster with Gmail-native actions for sender-based selection, unsubscribe access, and archiving.

## Permission justifications

### `storage`
Used to save extension preferences and workflow state needed for user-triggered actions.

### `https://mail.google.com/*` (host permission)
Required so the extension can run only inside Gmail web and interact with Gmail's on-page UI elements when the user clicks extension actions.

## Remote code declaration

Answer: **No**

Justification:
This extension does not use remotely hosted executable code. All JavaScript is packaged with the extension (`content.js`, `popup.js`) and loaded locally via Manifest V3 (`content_scripts` and local `popup.html` script reference). It does not load external JS/Wasm files, does not use remote module imports, and does not execute code from strings (for example via `eval` or `new Function`).

## Data handling summary

- The extension does not sell personal data.
- The extension does not transfer user data to external servers.
- The extension does not use data for advertising.
- Actions are initiated only by explicit user interaction.

## Privacy policy URL text

Use the content from:
- `docs/PRIVACY_POLICY.md`

If you host it publicly (recommended), point the CWS privacy policy URL to that hosted page.

## Short description

Clean your Gmail inbox faster with Gmail-native unsubscribe and archive actions.

## Detailed description

Gmail Unsubscriber Ondevice adds a compact sidebar inside Gmail with fast actions for bulk cleanup. It helps you find emails by sender, select matching conversations, archive listed emails, and trigger unsubscribe controls from the open message view using Gmail's existing interface.

# Gmail Unsubscriber Ondevice

Current project state for the version `2.1.0` Chrome Web Store package in this repo.

## Release snapshot

- Product name: `Gmail Unsubscriber Ondevice`
- Manifest version: `3`
- Current package version in `manifest.json`: `2.1.0`
- Supported surface: Gmail web only (`https://mail.google.com/*`)
- Primary UI: in-page Gmail sidebar plus extension popup

## What the extension does today

The extension injects a floating `Gmail unsubscriber` toggle into Gmail and opens a sidebar with Gmail-native cleanup actions. It helps users work from the currently open email, identify the sender, switch back to inbox/search view, select matching conversations, archive emails, unsubscribe when Gmail exposes an unsubscribe control, and move to the next email in a cleanup flow.

## Current user-facing actions

Sidebar actions:

- `Unsubscribe Open Email`
- `Select All Emails Like Open Email`
- `Archive Listed Emails in This Page`
- `Archive Listed Emails in All Pages`
- `Go to Inbox`
- `Go to Next Email`
- `Execute Selected`
- `Stop Execution`

Popup settings:

- Show or hide the in-page extension UI
- Configure `Max pages to scan` for next-email targeting

## Current workflow

1. The user opens an email in Gmail.
2. The extension reads the sender from the open thread.
3. `Select All Emails Like Open Email` navigates to inbox/search and builds a sender-based Gmail search.
4. Archive actions operate only after that sender context has been locked.
5. `Unsubscribe Open Email` tries Gmail's visible unsubscribe control in the open message.
6. `Go to Next Email` caches and opens the next different-sender thread so the user can continue triage.
7. `Execute Selected` runs checked actions as a batch and clears temporary next-email cache after the run.

## Current safeguards and behavior

- The extension runs only on Gmail pages.
- Archive actions validate that the current Gmail search still matches the sender selected earlier.
- Batch execution can be stopped by the user.
- If no unsubscribe control is found, the user gets a proceed/stop confirmation.
- The extension stores local UI state, scan limit, checkbox state, and temporary next-email cache in `chrome.storage.local`.
- No remote code is loaded and no data is sent to external servers.

## Permissions and access

- `storage`: stores local preferences and temporary workflow state
- `https://mail.google.com/*`: required so the extension can interact with Gmail's on-page UI

## Files that define the current behavior

- `manifest.json`: extension metadata, permissions, popup, content script registration
- `content.js`: Gmail sidebar, batch actions, Gmail DOM automation, safety checks
- `styles.css`: in-page sidebar styles
- `popup.html`, `popup.js`, `popup.css`: popup UI and local settings
- `background.js`: dev auto-reload support
- `docs/PRIVACY_POLICY.md`: privacy statement for store submission

## Notes for this publish

- The codebase currently includes batch execution, stop controls, next-email targeting, and popup-based local settings in addition to the original unsubscribe/select/archive flow.
- This repo is ready to package as version `2.1.0`.

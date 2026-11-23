# Gmail Unsubscriber Ondevice

A Chrome extension that adds a Gmail-native cleanup sidebar for unsubscribe, sender-based selection, batch execution, archiving, and next-email navigation.

## Folder structure

```text
.
├── manifest.json        # MV3 manifest
├── background.js        # service worker (keyboard shortcut -> Execute Selected)
├── content.js           # Gmail sidebar and DOM automation
├── styles.css           # in-page sidebar styles
├── popup.html           # toolbar popup (settings)
├── popup.js
├── popup.css
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/
│   └── package.sh       # builds the release zip
├── docs/
│   ├── screenshots/
│   ├── store-assets/
│   ├── CHROME_WEB_STORE_SUBMISSION.md
│   ├── CWS_FORM_ANSWERS.md
│   └── PRIVACY_POLICY.md
├── privacy-policy.html
├── extension.md
├── README.md
├── LICENSE
└── .gitignore
```

`release/` is gitignored; it is created locally by `scripts/package.sh`.

## Features

- `Unsubscribe Open Email`
- `Select All Emails Like Open Email`
- `Archive Listed Emails in This Page` — followed by an `Undo archive` button (~10s) that clicks Gmail's own Undo
- `Archive Listed Emails in All Pages` — shows a dry-run count ("About to archive ~1,234 conversations from ...") before archiving, then offers `Undo all`, which moves that sender's archived mail (`from:<sender> -in:inbox`) back to Inbox after confirmation
- `Go to Inbox`
- `Go to Next Email`
- `Show Archived` — searches for archived emails from the current sender
- `Execute Selected` — also bound to a keyboard shortcut (`Ctrl+Shift+E`, `Command+Shift+E` on macOS); see Keyboard shortcuts below
- `Stop Execution`
- Proceed/stop confirmation (with auto-proceed countdown) when no unsubscribe control is found
- Keyboard shortcuts (see below), shown on the sidebar buttons
- Popup `Stats` — today / all-time counts of senders unsubscribed, conversations archived, pages archived and batches run, with a `Reset stats` button. Stored only in `chrome.storage.local` (per-day totals kept for 30 days); never leaves the device.
- Draggable sidebar panel — drag by header, position persists across sessions
- Draggable toggle button — slides along Y-axis, grip icon on hover
- Buttons and checkboxes disable automatically when no email is open or an action is running
- Popup setting to show or hide the in-page extension UI
- Popup setting for `Max pages to scan` (1–200, default 5) when preparing next-email targeting

## Keyboard shortcuts

Chrome allows at most four default shortcuts per extension. Rebind any of these, or bind the unassigned ones, at `chrome://extensions/shortcuts`.

| Command | Windows / Linux | macOS |
| --- | --- | --- |
| Execute Selected | `Ctrl+Shift+E` | `Command+Shift+E` |
| Unsubscribe Open Email | `Ctrl+Shift+U` | `Command+Shift+U` |
| Go to Next Email | `Ctrl+Shift+Y` | `Command+Shift+Y` |
| Select Like Open Email, then Archive All Pages | `Ctrl+Shift+K` | `Command+Shift+K` |
| Select All Emails Like Open Email | unassigned | unassigned |
| Archive Listed Emails in This Page | unassigned | unassigned |
| Archive Listed Emails in All Pages | unassigned | unassigned |
| Go to Inbox | unassigned | unassigned |
| Stop Execution | unassigned | unassigned |

Shortcuts follow the same rules as the buttons: they are ignored while the sidebar is hidden, refused while an action is running (except Stop Execution), and most need an open email.

## Installation (local)

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder (the one containing `manifest.json`).
5. Open Gmail and refresh the tab.

## Requirements

- Gmail web UI (`https://mail.google.com/*`)

## Usage

1. Open an email from a sender you want to clean up.
2. Open the extension sidebar in Gmail.
3. Use individual buttons for one-off actions, or check multiple actions and click **Execute Selected** to run a batch.
4. Typical batch flow: **Select All Emails Like Open Email** and then **Archive Listed Emails in This Page** or **Archive Listed Emails in All Pages**.
5. Optionally include **Go to Next Email** to continue the cleanup flow across senders.

## Notes

- Uses Gmail's existing UI actions.
- The sidebar launcher inside Gmail is labeled `Gmail unsubscriber`.
- Gmail DOM and labels can change over time, so selectors may need updates.
- Test with a small sender batch first.

## Packaging a release

Build the Chrome Web Store upload zip with:

```bash
./scripts/package.sh
```

It reads the version from `manifest.json` and writes `release/Gmail_unsubscriber_on_device_v<version>.zip` containing only the runtime files (manifest, JS, CSS, popup, icons). To ship a new runtime file, add it to the `RUNTIME_FILES` list at the top of the script.

Release zips are not committed to git; they are built with this script and attached to the matching GitHub Release.

## Chrome Web Store release

- Current extension state doc: `extension.md`
- Submission checklist: `docs/CHROME_WEB_STORE_SUBMISSION.md`
- Privacy policy text: `docs/PRIVACY_POLICY.md`
- Listing screenshots folder: `docs/screenshots/`
- CWS form copy/paste answers: `docs/CWS_FORM_ANSWERS.md`
- Promo tile (440x280): `docs/store-assets/promo-tile-440x280.png`

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).

# Gmail Unsubscriber Ondevice

A Chrome extension that adds a Gmail-native cleanup sidebar for unsubscribe, sender-based selection, batch execution, archiving, and next-email navigation.

## Folder structure

```text
.
├── manifest.json        # MV3 manifest
├── background.js        # service worker (keyboard shortcut -> Execute Selected)
├── src/                 # Content scripts (load order in manifest.json)
│   ├── matching.js      # DOM-free matching helpers (unit-tested)
│   └── ...              # selectors, search, archive, unsubscribe, next-email, ui, main
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
- Optional `Delete Listed Emails in This Page` / `in All Pages` (off by default; enable in the popup). Same sender-locked flow as archive, but moves to Trash. Asks first (never auto-proceeds) unless confirmation is skipped in the popup

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

## Development

Requires Node.js 22.12 or newer. The extension itself has no build step; npm is only used for tooling.

```bash
npm install        # install dev tooling (vitest, jsdom, eslint, prettier)
npm test           # run unit + smoke tests (vitest, jsdom)
npm run lint       # eslint (flat config in eslint.config.js)
npm run format     # prettier --write (existing sources are excluded via .prettierignore)
```

- `tests/matching.test.js` covers the pure sender/subject/date matching helpers.
- `tests/smoke*.test.js` load the content scripts listed in `manifest.json` into hand-built Gmail DOM fixtures (`tests/fixtures/`) with `chrome.*` stubbed, and check that the sidebar mounts and the open-email sender is detected.
- `tests/load-content.js` is the loader. It defines `globalThis.__GC_TEST__` before the scripts run, and the content script's test hook puts its internals on that object (this does nothing in the real extension). When `src/matching.js` exists, the pure helpers are loaded from it with `require` instead.
- CI (`.github/workflows/ci.yml`) runs lint and tests on every push and pull request to `main`.

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

# Gmail Unsubscriber Ondevice

A Chrome extension that adds a Gmail-native cleanup sidebar for unsubscribe, sender-based selection, batch execution, archiving, and next-email navigation.

## Folder structure

```text
gmail-cleaner-extension/
├── manifest.json
├── content.js
├── styles.css
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── docs/
│   ├── screenshots/
│   ├── CHROME_WEB_STORE_SUBMISSION.md
│   └── PRIVACY_POLICY.md
├── README.md
├── LICENSE
└── .gitignore
```

## Features

- `Unsubscribe Open Email`
- `Select All Emails Like Open Email`
- `Archive Listed Emails in This Page`
- `Archive Listed Emails in All Pages`
- `Go to Inbox`
- `Go to Next Email`
- `Show Archived` — searches for archived emails from current sender
- `Execute Selected` — also bound to a keyboard shortcut (`Ctrl+Shift+E`, `Command+Shift+E` on macOS); rebind it at `chrome://extensions/shortcuts`
- `Stop Execution`
- Draggable sidebar panel — drag by header, position persists across sessions
- Draggable toggle button — slides along Y-axis, grip icon on hover
- Buttons and checkboxes disable automatically when no email is open or an action is running
- Popup setting to show or hide the in-page extension UI
- Popup setting for `Max pages to scan` when preparing next-email targeting

## Installation (local)

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `gmail-cleaner-extension`.
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

## Chrome Web Store release

- Current extension state doc: `extension.md`
- Submission checklist: `docs/CHROME_WEB_STORE_SUBMISSION.md`
- Privacy policy text: `docs/PRIVACY_POLICY.md`
- Listing screenshots folder: `docs/screenshots/`
- CWS form copy/paste answers: `docs/CWS_FORM_ANSWERS.md`
- Promo tile (440x280): `docs/store-assets/promo-tile-440x280.png`

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).

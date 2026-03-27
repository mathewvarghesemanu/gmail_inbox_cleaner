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
- `Execute Selected`
- `Stop Execution`
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

## Chrome Web Store release

- Current extension state doc: `extension.md`
- Submission checklist: `docs/CHROME_WEB_STORE_SUBMISSION.md`
- Privacy policy text: `docs/PRIVACY_POLICY.md`
- Listing screenshots folder: `docs/screenshots/`
- CWS form copy/paste answers: `docs/CWS_FORM_ANSWERS.md`
- Promo tile (440x280): `docs/store-assets/promo-tile-440x280.png`

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).

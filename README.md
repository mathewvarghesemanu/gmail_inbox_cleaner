# Gmail Sidebar Cleaner

A Chrome extension that adds a lightweight sidebar inside Gmail with quick actions to unsubscribe, select similar emails, and archive in bulk.

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

## Installation (local)

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `gmail-cleaner-extension`.
5. Open Gmail and refresh the tab.

## Requirements

- Gmail web UI (`https://mail.google.com/*`)
- Keyboard shortcuts enabled in Gmail settings (recommended for reliability)

## Usage

1. Open an email from a sender you want to clean up.
2. Open the extension sidebar in Gmail.
3. Click **Select All Emails Like Open Email**.
4. Click **Archive Listed Emails in This Page** (or **Archive Listed Emails in All Pages**).

## Notes

- Uses Gmail's existing UI actions.
- Gmail DOM and labels can change over time, so selectors may need updates.
- Test with a small sender batch first.

## Chrome Web Store release

- Submission checklist: `docs/CHROME_WEB_STORE_SUBMISSION.md`
- Privacy policy text: `docs/PRIVACY_POLICY.md`
- Listing screenshots folder: `docs/screenshots/`
- CWS form copy/paste answers: `docs/CWS_FORM_ANSWERS.md`
- Promo tile (440x280): `docs/store-assets/promo-tile-440x280.png`

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).

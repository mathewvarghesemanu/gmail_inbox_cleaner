# Gmail Sidebar Cleaner

A Chrome extension that adds a lightweight sidebar inside Gmail with quick actions to unsubscribe, select similar emails, and archive in bulk.

## Folder structure

```text
gmail-cleaner-extension/
├── manifest.json
├── content.js
├── background.js
├── styles.css
├── icons/
├── docs/
│   └── screenshots/
├── README.md
├── LICENSE
└── .gitignore
```

## Features

- `Unsubscribe (open email)`
- `Select All Like Open Email`
- `Archive All Listed`

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
3. Click **Select All Like Open Email**.
4. Click **Archive All Listed** (optionally use unsubscribe for the open message first).

## Notes

- Uses Gmail's existing UI actions.
- Gmail DOM and labels can change over time, so selectors may need updates.
- Test with a small sender batch first.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).

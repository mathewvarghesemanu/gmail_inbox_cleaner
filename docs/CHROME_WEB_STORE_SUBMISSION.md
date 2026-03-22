# Chrome Web Store Submission Checklist

## 1. Package checks

- [ ] `manifest.json` validates (MV3)
- [ ] Version is final for release
- [ ] Icons exist and are declared (`16`, `32`, `48`, `128`)
- [ ] No debug/test code left in release bundle
- [ ] Zip package root contains `manifest.json`

## 2. Listing assets

- [ ] App icon: use `icons/icon128.png`
- [ ] Screenshots added in `docs/screenshots/` for listing upload
- [ ] Small promo tile prepared (440x280): `docs/store-assets/promo-tile-440x280.png`
- [ ] Optional marquee promo tile (1400x560)

## 3. Listing text (suggested)

Title: Gmail Unsubscriber Ondevice

Short description:
Clean your Gmail inbox faster with Gmail-native unsubscribe and archive actions.

Detailed description:
Gmail Unsubscriber Ondevice adds a compact sidebar inside Gmail with fast actions for bulk cleanup. It helps you find emails by sender, select matching conversations, archive listed emails, and trigger unsubscribe controls from the open message view using Gmail's existing interface.

## 4. Privacy and compliance

- [ ] Publish privacy policy from `docs/PRIVACY_POLICY.md`
- [ ] Use copy/paste answers from `docs/CWS_FORM_ANSWERS.md`
- [ ] Data usage form completed accurately in CWS dashboard
- [ ] Permissions are justified in listing
- [ ] Single purpose clearly stated: Gmail inbox cleanup workflow
- [ ] Confirm no remotely hosted executable code

## 5. Final publish

- [ ] Upload zip in Chrome Web Store Developer Dashboard
- [ ] Complete Store Listing, Privacy, and Distribution tabs
- [ ] Submit for review

## Zip command

Run from project root:

```bash
zip -r gmail-unsubscriber-ondevice-v1.1.0.zip . -x "*.git*" "docs/screenshots/*" "*.DS_Store"
```

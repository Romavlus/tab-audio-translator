# Screenshots

**English** | [Русский](MEDIA.ru.md)

Screenshots are captured from the extension's actual HTML/CSS/JavaScript screens in an isolated browser. They use example text and mocked APIs: no requests go to Google, and no real key or user history is used. They illustrate the interface rather than translation quality or latency.

## Regenerate

```sh
npm ci
npx playwright install chromium
npm run docs:screenshots
```

English screenshots are written to `docs/screenshots/`; Russian screenshots to `docs/ru/screenshots/`.

Inspect the results: text should be readable, no key or personal data should appear, and screens should not be clipped. Temporary reports are excluded by `.gitignore`.

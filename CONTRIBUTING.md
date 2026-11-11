# Contributing

Next Choices is built from one TypeScript source tree for two hosts.

| Path | What it is |
| --- | --- |
| `src/shared/` | Host-independent logic: settings, prompt building, response parsing, formatting. |
| `src/st/` | SillyTavern extension. Built to `index.js`. |
| `src/lumiverse/` | Lumiverse (Spindle) extension. Built to `dist/frontend.js` and `dist/backend.js`. |
| `manifest.json`, `settings.html`, `style.css`, `i18n/` | SillyTavern manifest, settings panel, styles and translations. |
| `spindle.json` | Lumiverse manifest. |
| `test/` | Bun tests. |

## Setup

Requires [Bun](https://bun.sh).

```
bun install
bun run typecheck
bun test
bun run build
```

## Rules of thumb

- Edit `src/`, never `index.js` or `dist/` directly. Run `bun run build` and commit the generated
  files with your change: both hosts install straight from GitHub, so they must stay in sync.
- Put logic both hosts need in `src/shared/`, and keep host APIs out of it.
- New UI strings go through `tr()`. Add the Traditional Chinese text to `i18n/zh-tw.json`
  (SillyTavern) and `src/lumiverse/i18n.ts` (Lumiverse).
- When you change a manifest version, bump `manifest.json`, `spindle.json` and `package.json`
  together.
- Make sure `bun run typecheck` and `bun test` pass before opening a pull request.

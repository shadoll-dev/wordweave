# Wordweave

A word-search puzzle game — single-page, no build step, no dependencies.

**Play it live: [wordweave.shadoll.com](https://wordweave.shadoll.com)**

## Features

- Find every word from a themed category hidden in a grid of letters, running in any of the 8 straight-line directions (horizontal, vertical, diagonal — forwards or backwards)
- Tap letters one at a time to trace a word — each tap adds a numbered badge showing the order you picked it in; tap the last letter again to undo it
- Two words can cross through the same shared letter
- A word is marked found automatically the instant your selection spells it — no submit button
- **English and Ukrainian**, auto-detected from the browser's language and switchable from the "⋮" menu
- **Six word categories** — Animals, Countries, Food, Colors, Sports, Space — selectable from the "⋮" menu
- **Difficulty filter** — Easy (9×9, 8 words) / Moderate (11×11, 12 words) / Hard (13×13, 16 words), shown as a colored badge next to the title; also in the "⋮" menu
- Each category mixes short (3–4 letter) and long (7+ letter) words, and words are placed to cross through shared letters wherever possible — grids are dense, not a handful of same-length words lost in empty space
- A timer tracks how long the current puzzle has taken
- **Session statistics** — puzzles played, puzzles completed, total words found, and best completion time per difficulty — tracked separately per language, all in `localStorage`
- Progress (including the in-progress grid and timer) persists across page reloads, per language
- Light/dark theme support (follows system preference)
- App icon designed for Apple's Liquid Glass treatment on "Add to Home Screen" (full-bleed square, no baked-in corners/shadow), plus a `manifest.json` for standalone launch

## Running locally

No build tools or dependencies required — it's plain HTML/CSS/JS.

```bash
python3 -m http.server 8971
```

Then open [http://localhost:8971](http://localhost:8971).

> Word lists are loaded via `fetch()`, so the game must be served over HTTP — opening `index.html` directly as a `file://` URL won't work.

## Project structure

| File                  | Purpose                                                        |
| --------------------- | --------------------------------------------------------------- |
| `index.html`          | Page markup: header (title, found-count badge, timer, menu), board, word list, modals, footer |
| `style.css`           | All styling, including light/dark theme variables               |
| `script.js`           | Game logic: grid generation & word placement, tap-selection handling, stats, persistence, category/difficulty/language switching |
| `i18n.js`             | UI text for each supported language (`en`, `uk`)                 |
| `words.en.json`       | English word data, grouped by category                          |
| `words.uk.json`       | Ukrainian word data, same shape                                 |
| `icon.svg`            | Master app icon (scalable, also used as the browser favicon)     |
| `apple-touch-icon.png`, `favicon-32.png`, `favicon-16.png`, `icon-512.png` | Rasterized icon sizes |
| `manifest.json`       | PWA metadata for "Add to Home Screen"                            |
| `CNAME`                | Custom domain for GitHub Pages                                   |

## Deployment

Pushing to `main` triggers `.github/workflows/pages.yml`, which publishes the site to GitHub Pages at the custom domain configured in `CNAME`.

## License

No license specified.

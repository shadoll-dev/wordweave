# Wordweave

A word-search puzzle game — single-page, no build step, no dependencies.

**Play it live: [wordweave.shadoll.com](https://wordweave.shadoll.com)**

## Features

- Find every word from a themed category hidden in a grid of letters, running in any of the 8 straight-line directions (horizontal, vertical, diagonal — forwards or backwards)
- Tap letters one at a time to trace a word — each tap adds a numbered badge showing the order you picked it in; tap the last letter again to undo it
- Two words can cross through the same shared letter
- A word is marked found automatically the instant your selection spells it — no submit button
- **English and Ukrainian**, auto-detected from the browser's language and switchable from the "⋮" menu
- **23 word categories** — Animals, Clothing, Colors, Countries, Fitness, Food, Global Cities, Gymnastics, Islands, Jobs, Languages, Money, Music, Nativity, Onomatopoeia, Plants, Playing Cards, Royal Family, Space, Sports, Stationery, Vehicles, Weather. Every category has a set of named **topics** (e.g. Food splits into Vegetables, Savory & Mains, Sweets & Drinks, Common Fruits, Exotic Fruits & Berries, Soft Cheeses, Hard & Aged Cheeses — cheese and fruit are foods, not their own categories) plus an All Mixed option to pull from all of a category's topics at once
- **Category picker: Random or Select**, in the "⋮" menu. Random (default) picks a category and topic automatically each time you start a new puzzle. Select opens a tree list — tap a category name for a mixed puzzle from all its topics, or tap ▸ to expand it and pick one topic specifically — with the difficulty picker right there too, so both are set in one place before the puzzle generates
- **Difficulty filter** — Easy / Moderate / Hard, shown as a colored badge next to the title; also in the "⋮" menu. Grid size (roughly 7×7 up to 14×14, depending on difficulty) is sized to the chosen word-set so puzzles stay dense rather than sparse
- Each set mixes short (3–4 letter) and long (7+ letter) words, and words are placed to cross through shared letters wherever possible — grids are dense, not a handful of same-length words lost in empty space
- **Bonus words** — 2–3 of the words already on the list secretly appear a second time elsewhere in the grid. Find that second occurrence and the word's chip is marked with a gold ★, on top of the normal find
- Every puzzle opens on a "Ready to play" screen — the grid and word list stay hidden and the clock doesn't start until you tap Start. Pause any time after that (⏸ next to the timer) to stop the clock and hide the grid and word list again; resuming picks the clock back up exactly where it left off, even across a page reload
- On wide landscape screens, the word list sits in a scrollable column beside the board instead of below it; portrait (and narrow landscape) keeps the list below the board
- **Session statistics** — puzzles played, puzzles completed, total words found, bonus words found, and best completion time per difficulty — tracked separately per language, all in `localStorage`
- Progress (including the in-progress grid and timer) persists across page reloads, per language
- Light/dark theme support (follows system preference)
- App icon designed for Apple's Liquid Glass treatment on "Add to Home Screen" (full-bleed square, no baked-in corners/shadow), plus a `manifest.json` for standalone launch
- **Works offline** — a service worker precaches the whole app (including both languages' word lists) on first visit, so it keeps working with no network connection after that

## Running locally

No build tools or dependencies required — it's plain HTML/CSS/JS.

```bash
python3 -m http.server 8972
```

Then open [http://localhost:8972](http://localhost:8972).

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
| `sw.js`               | Service worker — precaches the app for offline use               |
| `CNAME`                | Custom domain for GitHub Pages                                   |

## Deployment

Pushing to `main` triggers `.github/workflows/pages.yml`, which publishes the site to GitHub Pages at the custom domain configured in `CNAME`.

## License

No license specified.

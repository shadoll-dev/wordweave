# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

Wordweave — a word-search puzzle game with English/Ukrainian support, themed word categories, and a difficulty (grid size) picker. Plain HTML/CSS/JS single-page app, no framework, no build step, no package manager. Everything runs directly in the browser.

## Running & verifying changes

There is no build step. Serve the directory over HTTP and load it in a browser:

```bash
python3 -m http.server 8971
```

`script.js` fetches `words.en.json` / `words.uk.json` at startup (whichever is active), so the app must be served over HTTP(S) — it will not work opened as a `file://` URL.

After editing `script.js`, sanity-check syntax before assuming it works:

```bash
node --check script.js
```

There are no automated tests. Verify behavior by loading the page in a browser (or headlessly via Playwright/`chromium-cli`, which this project's history has used for exactly this) and playing through the affected flow: generate a puzzle, trace a word forwards/diagonally/reversed by tapping cells in sequence, confirm badges appear in order and the last-tapped cell undoes on re-tap, confirm a completed word auto-marks found (cell highlight + struck-through chip) and updates the header's found-count badge, finish a whole puzzle and check the win message + stats, switch category/difficulty/language mid-puzzle (confirm modal should fire since progress exists), reload mid-puzzle (state should resume, including the timer), and open the Stats modal.

## Architecture

- **`index.html`** — static markup only: header (title + difficulty badge + found-count badge + timer + the "⋮" menu with Stats/Category/Difficulty/Language), the board grid, the word-list panel, and three modals (`help-modal`, `stats-modal`, `confirm-modal`). All modals share the `.modal`/`.modal-content` CSS classes and the same open/close pattern (toggle `.hidden`) — same pattern as the sibling `worder` project. User-facing text carries `data-i18n="key"` (sets `textContent`) or `data-i18n-title="key"` (sets `title` + `aria-label`); `applyStaticTranslations()` in `script.js` walks these on load and on language switch. Adding new UI text means adding both the attribute here and the key in `i18n.js` for every language.
- **`style.css`** — all styling. Theme colors are CSS custom properties on `:root`, overridden in `@media (prefers-color-scheme: dark)`. `#board` sizes itself from the `--cols` custom property (set in JS via `style.setProperty`) referenced in `grid-template-columns`/`grid-template-rows` — don't hardcode a column count in CSS, the same stylesheet serves all three grid sizes.
- **`i18n.js`** — `const I18N = { en: {...}, uk: {...} }`, loaded before `script.js`. Category labels (`categoryAnimals`, etc.) and difficulty labels (`levelEasy`, etc.) live here, not in the word JSON files — the JSON only holds the raw word lists. Keep both language objects in sync; a key present in one but not the other renders `undefined` for the missing language (no fallback).
- **`script.js`** — a single IIFE, no modules/bundler. Key state: `currentLang`/`wordLevel`/`currentCategory`, `grid` (2D letter array), `targetWords` (the words actually placed in the current puzzle — may be a subset of the category if some words didn't fit, see below), `found` (`[{word, cells}]`), `selection` (`[[r,c], ...]`, the in-progress tap sequence) and `direction` (locked after the 2nd tap of a new selection). `LEVEL_CONFIG` maps difficulty to `{size, wordCount}` (easy 9×9/8 words, moderate 11×11/12, hard 13×13/16) — grids are kept small relative to word count on purpose (see below) so difficulty comes from density, not empty space. `DIRECTIONS` is the 8 straight-line vectors; word letters always sit in adjacent cells along one of these, so the tap-selection logic only ever needs to check immediate-neighbor steps, not arbitrary jumps.
- **`words.en.json`** / **`words.uk.json`** — `{ "categories": { "animals": { "words": [...] }, ... } }`, one file per language, ~16–20 words per category. Words are lowercase, single alphabetic tokens (no spaces/hyphens), 3–16 letters (16 = the hard grid's max dimension). Each category deliberately mixes short (3–4 letter) and long (7+ letter) words — a category of same-length words makes the puzzle trivially easy on any grid bigger than the word length, regardless of grid size, which is why `buildPuzzle()`'s difficulty comes from grid density (see below), not just size. If you add a category, keep that length spread, add its id + word list to both language files, and add the matching `category<Id>` key to both `i18n.js` language objects — `renderMenus()` looks up `category${capitalize(id)}` and will render `undefined` if the key is missing.

## Word placement & the puzzle generator (important limitation)

`buildPuzzle()` in `script.js` picks up to `wordCount` words from the active category (filtered to fit the grid) and sorts longer words first (they're harder to place). `placeWord()` places each word by **preferring overlap**: `findOverlapPlacements()` scans the grid for every already-filled cell matching one of the word's letters and tries anchoring the word through that cell in all 8 directions, keeping every placement that doesn't conflict with existing letters; if any such crossing placement exists, one is picked at random from those. Only when no word already on the grid shares a letter with it (always true for the first, longest word placed) does it fall back to `MAX_PLACEMENT_ATTEMPTS` random `(position, direction)` tries. This is what makes words actually interlock — don't revert to pure-random placement, since that's what caused the original "45 letters lost in a 169-cell grid" problem this scheme replaced. **A word that never finds a valid placement is silently dropped from that puzzle** — `targetWords` only ever contains words that actually made it into the grid, so the word-list panel and win condition are always consistent with what's actually findable. This is rare in practice but is a known, intentional trade-off rather than a bug — don't "fix" it by retrying the whole puzzle or increasing attempts indefinitely; that risks hangs on pathological inputs. If asked to guarantee every category word always appears, that requires a real backtracking placer (place-and-undo on failure), which is a bigger change — flag the trade-off rather than silently rewriting the generator.

Empty cells are filled with a uniform-random letter from that language's alphabet (`ALPHABETS.en`/`ALPHABETS.uk`) — not frequency-weighted, so a grid can look a little more consonant-heavy or vowel-heavy than natural text. Same kind of documented simplification as `worder`'s difficulty-scoring caveat; flag it rather than silently trying to fix it if asked to make filler letters "more natural."

## Selection interaction (why it's implemented this way)

Selecting a word is deliberately tap-by-tap, not click-and-drag or click-start/click-end:

1. First tap on any cell starts `selection = [cell]`.
2. The second tap only extends the selection if it's an **immediate 8-directional neighbor** of the first cell — that locks `direction` for the rest of this selection. A non-adjacent second tap discards the first cell and starts a fresh selection at the new cell instead (no error state, just a restart).
3. From then on, only the exact next cell in the locked direction (`last + direction`) extends the selection; anything else restarts a fresh selection there.
4. Tapping the *current last* selected cell again pops it (undo one letter) — this single rule also handles "clear everything," since popping the only cell in a length-1 selection empties it. There is intentionally no separate "tap the first cell to clear all" rule; keep it that way unless asked to change it, since a second rule here would create an ambiguous case when the first and last cell are the same.

After every tap, `checkMatch()` joins the selected cells' letters and compares the string directly against `targetWords` still unfound — a match is a match regardless of which direction it was read in, so there's no separate forwards/backwards check.

## State & persistence

`localStorage` keys, mirroring `worder`'s naming style:

- `wordweave-lang` — active language (`"en"`/`"uk"`), detected via `navigator.language` if unset.
- `wordweave-level` — active difficulty (`"easy"`/`"moderate"`/`"hard"`), defaults to `"moderate"`.
- `wordweave-category` — active category id, defaults to the first entry in `CATEGORIES`.
- `wordweave-state-${lang}` — the full in-progress puzzle: the *generated* grid, `targetWords`, `found`, `gameOver`, and a timer snapshot (`elapsedMsAtSave` + `wasTimerRunning`) so reload resumes the exact puzzle and keeps the clock running rather than replaying a seed. Keyed per language, like `worder`.
- `wordweave-stats-${lang}` — `{ played, completed, wordsFound, bestTimes: {easy, moderate, hard} }`. `played` increments every time a new puzzle is generated (including on first load); `completed`/`wordsFound`/`bestTimes` only update once, guarded by `statsRecorded`, when all of a puzzle's `targetWords` are found.

If you add new persisted fields, update both the save (`saveState`/`saveStats`) and load (`loadState`/`loadStats`) functions, and give the load side a sane default so old saved data (missing the new field) doesn't break — `loadStats` already does this per-field.

## Conventions

- No comments explaining *what* code does — only *why*, when non-obvious (see existing sparse comments as the bar).
- No build tooling, no dependencies. Keep it that way unless explicitly asked to add a bundler/framework.
- Overflow actions live in the "⋮" menu (`#menu-panel`), not as standalone header buttons — reuse the existing `radiogroup` pattern (`buildRadioOptions()`) for any new global setting rather than adding a header button.
- Native browser dialogs (`confirm()`/`alert()`) are intentionally avoided in favor of the styled `.modal` pattern — don't reintroduce them. The `pendingConfirmAction` + `requestFreshGame()` guard (shared by New Game, and by category/difficulty/language changes) is the pattern to reuse for anything else that should warn before discarding in-progress puzzle state.
- Each found word gets its own color from an 8-color round-robin palette (`--word-0`..`--word-7` in `style.css`), assigned by `wordColorIndex()` in `script.js` from the word's fixed position in `targetWords` — stable across re-renders and reloads without needing extra persisted state. A cell shared by two found words renders a diagonal two-color split (`linear-gradient`, built inline in `renderBoard()` from `var(--word-N)` so it stays theme-aware); three+ overlapping found words at one cell only show the first two colors (rare, undocumented beyond this note — a real fix would need a wedge/stripe layout per additional color).

## Deployment

`.github/workflows/pages.yml` deploys `main` to GitHub Pages on every push, serving at the custom domain in `CNAME` (`wordweave.shadoll.com` — DNS for this must be configured separately from this repo). The workflow copies an explicit file list into a `dist/` folder before publishing — if you add new site assets (a new language's word file, a new icon size, etc.), add them to that `cp` list too or they won't ship.

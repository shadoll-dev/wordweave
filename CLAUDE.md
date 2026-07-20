# CLAUDE.md

See [AGENTS.md](./AGENTS.md) — it contains the full guidance for AI coding agents working in this repository (architecture, word placement, selection interaction, state/persistence, conventions, deployment).

## Quick description

Wordweave is a word-search puzzle game: find every word from a themed category (Animals, Countries, Food, Colors, Sports, Space, Weather, Jobs, Vehicles, Clothing, Music) hidden in a grid of letters, readable in any of the 8 straight-line directions. Plain HTML/CSS/JS, no framework or build step. Each category holds several curated word-sets; a puzzle draws from one at random. Tap letters one at a time to trace a word — each tap adds a numbered badge, and a completed word is marked found automatically. Words are placed to cross through shared letters wherever possible, and grid size is computed per puzzle from the chosen word-set to stay dense rather than sparse. Supports English and Ukrainian, a difficulty picker (shown as a badge next to the title), and per-language best-time stats — all persisted in `localStorage`. Live at [wordweave.shadoll.com](https://wordweave.shadoll.com).

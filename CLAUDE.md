# CLAUDE.md

See [AGENTS.md](./AGENTS.md) — it contains the full guidance for AI coding agents working in this repository (architecture, word placement, selection interaction, state/persistence, conventions, deployment).

## Quick description

Wordweave is a word-search puzzle game: find every word from a themed category (Animals, Countries, Food, Colors, Sports, Space) hidden in a grid of letters, readable in any of the 8 straight-line directions. Plain HTML/CSS/JS, no framework or build step. Tap letters one at a time to trace a word — each tap adds a numbered badge, and a completed word is marked found automatically. Supports English and Ukrainian, a difficulty picker (grid size 10×10 / 13×13 / 16×16), and per-language best-time stats — all persisted in `localStorage`. Live at [wordweave.shadoll.com](https://wordweave.shadoll.com).

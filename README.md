# Flashcard+

Spaced repetition flashcards for Obsidian with specialized engines for grids, maps, star charts, timelines, code, and audio — all living inside your vault notes.

---

## Features

- **Multiple card engines** — grid, map, constellation, timeline, SVG, code, audio, and traditional front/back
- **Spaced repetition (SRS)** — SM-2-style scheduling tracks each card individually across devices
- **Daily & Endless sessions** — daily mode uses SRS scheduling; endless mode lets you drill freely
- **Easy mode** — click-to-answer variants for grid, map, and constellation cards
- **Inline preview** — live interactive previews render inside your notes with clickable name chips that pan the view
- **Fullscreen support** — expand map and constellation views to full screen during review
- **Memory Matrix** — GitHub-style contribution calendar showing your review history

---

## Card Types

### Traditional
Standard front / back flashcards. Supports math (KaTeX), markdown, and custom CSS.

### Grid
A fully rendered grid (e.g. periodic table, multiplication table) where the target cell is hidden. In Easy Mode the full grid is shown and you click the correct cell.

### Map
An interactive Leaflet map. Cards can target a **region** (click or identify a country/area) or a **point** (identify a city or landmark). Supports historical era layers. Easy Mode highlights regions for clicking.

### Constellation
A gnomonic sky-projection canvas matching the inside-sphere view you see from Earth (like Stellarium). Cards ask you to name or click a constellation. Stick figure lines and star magnitudes are rendered. If you pan away from the answer, a green arrow guides you back.

### Timeline
Place events on an interactive timeline. Cards hide a pin and ask you to identify when something happened.

### SVG
Annotate any SVG image with labeled pins. Cards hide a pin and ask you to identify the location.

### Code
Syntax-highlighted code cards with hidden sections.

### Audio
Audio playback cards.

---

## Setup

### 1. Tag your notes

Add `#flashcard` to any note that contains card data. The plugin scans your entire vault for this tag each time you start a session.

### 2. Start a session

Click the **brain** ribbon icon (or use the command palette) to open Session Settings. Choose your decks, session type, and options, then click **Start**.

---

## Sessions

### Daily Session
Pulls cards that are due today based on SRS intervals. New cards are introduced at a controlled rate per deck. Results are saved and affect future scheduling.

### Endless Session
Drill any selected decks without affecting SRS state. Options:
- **Re-add wrong cards** — incorrect cards are reinserted a few positions ahead in the queue
- **Easy Mode** — click-to-answer interface for grid, map, and constellation cards

---

## Inline Preview

Add a code block referencing a card deck in any note to render a live interactive preview:

- **Map cards** — shows a Leaflet map with all regions highlighted; click a name chip to fly the map to that location
- **Constellation cards** — shows a draggable star chart; click a name chip to pan the view to that constellation

---

## Sync

Plugin data (SRS state, session history) is stored in `.obsidian/plugins/flashcard-plus/data.json`. The plugin re-reads this file every time you open a session, so changes synced from another device are always picked up.

Make sure your sync solution (Obsidian Sync, iCloud, Dropbox, etc.) is configured to include the `.obsidian` folder.

---

## Manual Installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](../../releases/latest).
2. Copy them to `<your vault>/.obsidian/plugins/flashcard-plus/`.
3. Enable **Flashcard+** in Obsidian → Settings → Community Plugins.

---

## Contributing

Issues and pull requests are welcome.

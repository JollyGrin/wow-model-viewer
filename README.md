# WoW Model Viewer

Self-hosted web viewer for Turtle WoW (1.12.x) character models. Renders all 20 race/gender combinations with full equipment (weapons, helmets, shoulders, shields, chest, legs, boots, gloves) using Three.js.

## Quick Start

### Prerequisites

- [bun](https://bun.sh/) (v1.0+)
- [Node.js](https://nodejs.org/) (v20+)
- A Turtle WoW client installation (for game data)

### 1. Extract game data

Point the setup script at your Turtle WoW installation. It copies MPQ archives, extracts patches, and converts DBC tables to JSON:

```bash
bun run setup -- /path/to/TurtleWoW
```

This populates `data/` with everything the build pipeline needs.

### 2. Build assets

Converts all raw game data into web-ready formats (character models, textures, items, catalog):

```bash
bun run build-assets
```

This runs the full 10-step pipeline. Takes a few minutes on first run.

### 3. Run

```bash
bun run dev
```

Open **http://localhost:5173/** — use the dropdowns to switch races, equip items, and randomize gear.

### One-liner alternative

```bash
./setup.sh
```

Checks prerequisites, installs deps, validates data, builds assets, and prints next steps.

## How Equipment Works

WoW uses two different systems for equipment rendering:

| Equipment | Rendering Method | Asset Location |
|-----------|-----------------|----------------|
| Weapons, Shields | Separate 3D models attached to hand bones | `public/items/weapon/`, `public/items/shield/` |
| Helmets | Separate 3D models attached to head bone (per race/gender) | `public/items/head/` |
| Shoulders | Separate 3D models attached to shoulder bones (L/R pair) | `public/items/shoulder/` |
| Chest, Legs, Boots, Gloves | Texture layers composited onto the body mesh | `public/item-textures/` |

Body armor has no 3D geometry — it works by painting textures onto the character's skin atlas and swapping geosets (e.g., bare feet vs. armored boots).

## Project Structure

```
src/
  main.ts             # Three.js scene, camera, lighting, race/gender UI
  loadModel.ts        # Model loading, geoset filtering, equipment attachment
  charTexture.ts      # Skin + equipment texture compositing
  equipmentUI.ts      # Equipment slot dropdowns, randomize UI
  animation.ts        # Animation state management
  lab.ts              # Debug/experimental UI
  all.ts              # All-races preview page

scripts/              # Asset pipeline (see below)
scripts/archive/      # Historical investigation scripts (not part of pipeline)

public/models/        # 20 character models (model.bin, model.json, anims.bin, textures/)
public/items/         # Item 3D models — gitignored, built by pipeline
public/item-textures/ # Armor region textures — gitignored, built by pipeline
public/item-catalog.json  # Item index — gitignored, built by pipeline

data/                 # Raw game data — gitignored, populated by setup
  model/              # Base MPQ archives (model.MPQ, texture.MPQ, patch.MPQ)
  patch/              # Extracted patch contents (patch-2 through patch-9, patch-y)
  dbc/                # DBC tables as JSON
```

## Scripts

### Pipeline scripts

These are run by `bun run build-assets` in the correct order. You don't normally need to run them individually.

| Script | What it does |
|--------|-------------|
| `extract-mpq-items.ts` | Extracts item M2 + BLP from MPQ archives |
| `extract-mpq-textures.ts` | Extracts item textures from MPQ archives |
| `extract-char-attachments.ts` | Extracts helmet attachment points from M2 data |
| `convert-model.ts` | Converts 20 character M2s to web format |
| `convert-textures.ts` | Converts character skin + hair BLPs to .tex |
| `convert-item-textures.ts` | Converts patch armor BLPs to .tex |
| `convert-item.ts` | Converts patch weapon M2s to web format |
| `convert-head-item.ts` | Converts helmet M2s (per race/gender) |
| `convert-shoulder-item.ts` | Converts shoulder M2s (L/R pairs) |
| `build-item-catalog.ts` | Indexes all converted items into catalog JSON |

### Setup scripts

| Script | What it does |
|--------|-------------|
| `setup-from-client.ts` | One-stop extraction from a TurtleWoW client installation |
| `extract-from-mpq.ts` | Lower-level MPQ extraction for base textures + DBCs |
| `parse-item-db.ts` | Downloads + parses the classic WoW item database SQL dump |

### Orchestration

| Script | What it does |
|--------|-------------|
| `build-assets.ts` | Runs the full 10-step pipeline in order with preflight checks |

## npm Scripts

| Command | What it does |
|---------|-------------|
| `bun run setup -- /path/to/TurtleWoW` | Extract game data from client |
| `bun run build-assets` | Build all web assets from extracted data |
| `bun run dev` | Start Vite dev server |
| `bun run build` | Production build (TypeScript + Vite) |
| `bun run test:e2e` | Run Playwright visual regression tests |

## Tech Stack

| Tool | Purpose |
|------|---------|
| Three.js | WebGL rendering with GPU skinning |
| @wowserhq/format | M2, BLP, DBC binary format parsing |
| @wowserhq/stormjs | MPQ archive extraction |
| Vite | Dev server and bundling |
| TypeScript | Type safety |
| Playwright | Visual regression testing |

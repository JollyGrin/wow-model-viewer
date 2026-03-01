# WoW Model Viewer

Self-hosted web viewer for Turtle WoW (1.12.x) character models. Renders 20 race/gender combinations with composited skin textures using Three.js.

## Quick Start

### 1. Add game data

You need files from your Turtle WoW client's `Data/` folder. Three things go into `data/`:

```
data/
├── model/                 ← copy directly from WoW client
│   ├── model.MPQ          # base character/item M2 models (182 MB)
│   └── texture.MPQ        # base BLP textures (634 MB)
│
├── patch/                 ← extract each patch-N.MPQ into its own folder
│   ├── patch-2/
│   ├── patch-3/
│   ├── patch-5/
│   ├── patch-6/           # most character models
│   ├── patch-7/           # goblin models
│   ├── patch-8/
│   ├── patch-9/
│   └── patch-y/
│
└── dbc/                   ← DBC files converted to JSON (for future use)
```

**Base MPQ archives** — Copy `model.MPQ` and `texture.MPQ` from your Turtle WoW `Data/` directory straight into `data/model/`.

**Patch files** — Extract each patch MPQ (`patch-2.MPQ` through `patch-9.MPQ`, `patch-y.MPQ`) into a matching directory under `data/patch/`. Use [Ladik's MPQ Editor](http://www.zezula.net/en/mpq/download.html) (Windows), [mpq-tools](https://github.com/ge0rg/mpq-tools) (Mac/Linux), or [wow.export](https://github.com/Kruithne/wow.export). The key files inside are `Character/<Race>/<Gender>/*.M2` (models) and `*.blp` (textures).

**DBC files** — Extract DBC tables from `misc.MPQ` (or `dbc.MPQ`) and convert to JSON. Optional for now — needed for future item/creature features.

See [`data/README.md`](data/README.md) for the full file inventory. The setup script will tell you exactly which files are missing.

### 2. Run setup

```bash
./setup.sh
```

This single command will:
- Check prerequisites (bun, node)
- Install dependencies
- Validate all required M2 and BLP files are present
- Convert models (M2 binary → JSON + vertex buffers)
- Convert textures (BLP → composited RGBA)
- Kill any existing process on port 5173
- Start the dev server

### 3. View

Open **http://localhost:5173/** and use the dropdowns to switch between races and genders.

## Prerequisites

- [bun](https://bun.sh/) (v1.0+)
- [Node.js](https://nodejs.org/) (v20+)

## Project Structure

```
src/
├── main.ts           # Three.js scene, camera, UI
├── loadModel.ts      # Model loading, geoset filtering, skinned mesh
└── charTexture.ts    # Texture region compositing

scripts/
├── convert-model.ts    # M2 v256 → model.json + model.bin
└── convert-textures.ts # BLP → skin.tex (composited atlas)

public/models/<race>-<gender>/
├── model.json          # Manifest (bones, geosets, layout)
├── model.bin           # Vertex + index buffers
└── textures/skin.tex   # RGBA texture atlas
```

## Tech Stack

| Tool | Purpose |
|------|---------|
| Three.js | WebGL rendering with GPU skinning |
| @wowserhq/format | M2, BLP binary format parsing |
| Vite | Dev server and bundling |
| TypeScript | Type safety |

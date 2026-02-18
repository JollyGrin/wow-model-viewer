# Research Overview: Self-Hosted WoW Model Viewer

## Goal

Build a web-based WoW character model viewer that renders characters with equipment **entirely from local game files**, independent of Wowhead/zamimg. Targeting Turtle WoW (1.12.x Vanilla client with custom content).

## Key Shift from Previous Approach

The previous research (in `docs/archive/`) focused on using the `wow-model-viewer` npm package which wraps Wowhead's ZamModelViewer and depends on their CDN (`wow.zamimg.com`). That approach cannot render Turtle WoW's custom content (High Elf/Goblin races, custom items).

**This research** covers building everything from scratch using raw game files.

## Research Documents

| Doc | Title | Covers |
|-----|-------|--------|
| [01](./01-file-extraction-guide.md) | File Extraction Guide | What files to copy from WoW installation, MPQ archives, directory structure |
| [02](./02-m2-format-deep-dive.md) | M2 Format Deep Dive | M2 binary format, BLP textures, .skin files, bones, animations |
| [03](./03-character-rendering-pipeline.md) | Character Rendering Pipeline | Geosets, texture compositing, equipment attachment, rendering order |
| [04](./04-open-source-libraries.md) | Open Source Libraries | GitHub projects, Three.js loaders, parsers, conversion tools |
| [05](./05-asset-cdn-architecture.md) | Asset CDN Architecture | How to organize/serve assets, build pipeline, caching, performance |
| [06](./06-dbc-data-pipeline.md) | DBC Data Pipeline | Database files, itemId->displayId mapping, metadata resolution |
| [07](./07-implementation-roadmap.md) | Implementation Roadmap | Recommended approach, phases, effort estimates |

## Critical Data Sources

| Source | URL | Purpose |
|--------|-----|---------|
| Turtle-WOW-DBC | `github.com/oplancelot/Turtle-WOW-DBC` | ItemDisplayInfo.dbc as JSON (23,852 records) |
| classic-wow-item-db | `github.com/thatsmybis/classic-wow-item-db` | SQL with itemId -> displayId mapping |
| wowdev.wiki | `wowdev.wiki` | Definitive format documentation for M2, BLP, DBC |
| StormLib | `github.com/ladislav-zezula/StormLib` | MPQ archive extraction |

## Core Technical Stack (Recommended)

- **Rendering**: Three.js
- **M2 Parsing**: `@wowserhq/format` (closest to vanilla format) + custom extensions
- **BLP Decoding**: Pre-convert to PNG/WebP at build time
- **DBC Data**: Pre-process to JSON at build time
- **Asset Serving**: Static file CDN with pre-converted assets
- **Reference Code**: `three-m2loader`, WoW Model Viewer (C++), `@wowserhq/scene`

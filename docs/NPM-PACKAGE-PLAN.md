# WoW Model Viewer — npm Package Restructure Plan

## Executive Summary

Turn this monolithic Vite app into two cleanly separated concerns:

1. **`@anthropic-grins/wow-model-viewer`** — npm package that renders WoW character models with equipment, animations, and a configurable asset source
2. **`tools/`** — CLI scripts that convert raw WoW game files into the web-ready assets the viewer consumes

The `/chron` page is the reference implementation: it points the viewer at a CDN (`models.chronicleclassic.com`), fetches item metadata from the Chronicle API, and passes resolved equipment options to the viewer. The npm package generalizes this pattern so anyone can swap in their own CDN and item database.

---

## Current Architecture (What Exists Today)

### Repository Layout

```
npm/
├── index.html, all.html, lab.html, chron.html    # 4 HTML entry points
├── src/
│   ├── main.ts              # Local viewer entry (211 lines)
│   ├── chron.ts             # Chronicle CDN viewer entry (187 lines)
│   ├── all.ts               # 20-race grid viewer entry (428 lines)
│   ├── lab.ts               # Post-processing lab entry (965 lines)
│   ├── loadModel.ts         # Core engine: model loading, skeleton, geosets, equipment (716 lines)
│   ├── charTexture.ts       # Core engine: texture composition (134 lines)
│   ├── animation.ts         # Core engine: animation playback (406 lines)
│   ├── assetBase.ts         # CDN URL resolution — global mutable state (27 lines)
│   ├── equipmentUI.ts       # Local catalog-based equipment UI (401 lines)
│   └── chronEquipmentUI.ts  # Chronicle API equipment UI (397 lines)
├── scripts/                  # Asset conversion pipeline (14 scripts, ~175KB)
├── public/                   # Generated web assets (~600MB, gitignored)
├── data/                     # Raw game data (multi-GB, gitignored)
├── e2e/                      # Playwright visual tests (7 spec files)
└── docs/                     # Research, learnings, plans (20+ docs)
```

### The Two Layers

The `/chron` page demonstrates the clean separation that the npm package should formalize:

**Layer 1: Asset Delivery (CDN)**
Static files — character models, item models, textures, animations. Identical for everyone using the same game version. Currently the `public/` folder, uploaded to Cloudflare R2 at `models.chronicleclassic.com`.

**Layer 2: Item Database (API)**
Maps item IDs to display properties (model paths, texture names, geoset groups). Server-specific — Turtle WoW has custom items that vanilla doesn't. Currently the Chronicle API at `chronicleclassic.com/api/v1/internal/gamedata/display/item/{id}`.

**The npm package only handles Layer 1.** Layer 2 is the consumer's responsibility — they bring their own item database (Chronicle API, a static JSON, Wowhead scrape, whatever). The package accepts **resolved equipment options**, not item IDs.

### How /chron Works Today

```typescript
// 1. Point at CDN
setAssetBase('https://models.chronicleclassic.com');

// 2. User enters item ID → fetch from Chronicle API
const item = await fetch(`/chronicle-api/v1/internal/gamedata/display/item/${itemId}`);
// Returns: { model_name, model_texture, geoset_group, texture[8], helmet_geoset_vis, ... }

// 3. Map API response → viewer options (chronEquipmentUI.ts does this)
const weaponPath = `/items/weapon/${slugify(item.model_name[0])}`;
const armorOptions = { armUpperBase: texBase(0, item.texture[0]), ... };

// 4. Load model with equipment
const [loaded, animData] = await Promise.all([
  loadModel('/models/human-male', { weapon: weaponPath, armor: armorOptions }),
  loadAnimations('/models/human-male'),
]);

// 5. Animate
const controller = new AnimationController(animData, loaded.boneData, loaded.bones);
controller.setSequence(0); // Stand
```

### Core Engine Files (What Goes Into the npm Package)

#### `loadModel.ts` (716 lines)

The main engine. Responsibilities:
- Fetches `model.json` (manifest) + `model.bin` (vertex/index buffers) from CDN
- Parses 40-byte vertex format: position(12B) + normal(12B) + uv(8B) + boneIndices(4B) + boneWeights(4B)
- Builds Three.js `Skeleton` with proper bone hierarchy, pivot transforms, and inverse bind matrices
- Resolves which geosets to show based on equipment (boots swap group 5, gloves swap group 4, robes extend group 13, etc.)
- Composites skin texture with equipment overlays (8 body regions)
- Attaches 3D item models to skeleton bones via attachment points:
  - Weapon → HandRight (att ID 1)
  - Offhand → HandLeft (att ID 2)
  - Helmet → Head (att ID 11)
  - Left Shoulder → ShoulderLeft (att ID 6)
  - Right Shoulder → ShoulderRight (att ID 5)
- Handles helmet geoset visibility (hiding hair, facial hair, ears per race)
- Creates separate `SkinnedMesh` for body (skin texture) and hair (hair texture)

**Key exports:**
```typescript
interface BoneInfo { parent: number; pivot: [x,y,z]; rotation: [x,y,z,w]; translation: [x,y,z]; }
interface LoadedModel { group: THREE.Group; bones: THREE.Bone[]; boneData: BoneInfo[]; }
interface BodyArmor {
  armUpperBase?: string; armLowerBase?: string; handBase?: string;
  torsoUpperBase?: string; torsoLowerBase?: string;
  legUpperBase?: string; legLowerBase?: string; footBase?: string;
  handGeoset?: number; footGeoset?: number; sleeveGeoset?: number;
  wristGeoset?: number; robeGeoset?: number;
  helmet?: string; helmetGeosetVisID?: [number, number]; helmetTexture?: string;
  shoulderSlug?: string; shoulderHasRight?: boolean; shoulderTexture?: string;
}
function loadModel(modelDir: string, options?: {
  weapon?: string; weaponTexture?: string;
  offhand?: string; offhandTexture?: string;
  armor?: BodyArmor;
}): Promise<LoadedModel>
```

**Every fetch call goes through `assetUrl(path)`** — the only place CDN base URL is applied. There are ~15 fetch calls total across loadModel:
- `fetch(assetUrl(modelDir + '/model.json'))`
- `fetch(assetUrl(modelDir + '/model.bin'))`
- `loadTexture(texturesDir + 'skin.tex')` → `fetch(assetUrl(url))`
- `loadTexture(texturesDir + 'hair.tex')` → `fetch(assetUrl(url))`
- `loadTexImageData(url)` (in charTexture.ts) → `fetch(assetUrl(url))`
- `fetch(assetUrl('/data/HelmetGeosetVisData.json'))`
- `loadItemModel(itemDir, texUrl)` → `fetch(assetUrl(itemDir + '/model.json'))` + `fetch(assetUrl(itemDir + '/model.bin'))` + `loadTexture(...)`

#### `charTexture.ts` (134 lines)

Composites multiple texture layers onto a 256x256 character atlas.

**Key exports:**
```typescript
enum CharRegion { ARM_UPPER, ARM_LOWER, HAND, FACE_UPPER, FACE_LOWER, TORSO_UPPER, TORSO_LOWER, LEG_UPPER, LEG_LOWER, FOOT }
function composeCharTexture(baseImageData: ImageData, layers: TextureLayer[]): HTMLCanvasElement
function loadTexImageData(url: string): Promise<ImageData>  // .tex format: u16 width + u16 height + RGBA
```

One fetch call: `loadTexImageData` → `fetch(assetUrl(url))`.

#### `animation.ts` (406 lines)

Parses `anims.bin` binary format and provides animation playback.

**Key exports:**
```typescript
function loadAnimations(modelDir: string): Promise<AnimData>
class AnimationController {
  constructor(anim: AnimData, boneData: BoneInfo[], bones: THREE.Bone[])
  setSequence(seqIndex: number): void
  getAnimationList(): Array<{ seqIndex, label, animId, subAnimId, duration }>
  update(deltaMs: number): void
}
```

One fetch call: `fetch(assetUrl(modelDir + '/anims.bin'))`.

#### `assetBase.ts` (27 lines)

Global mutable CDN config. **This gets replaced by the `AssetResolver` interface.**

```typescript
let _base = '';
let _authCookie = '';
function setAssetBase(url: string): void
function setAssetAuth(cookie: string): void
function assetUrl(path: string): string       // returns _base + path
function assetFetchOpts(): RequestInit | undefined  // returns auth headers if set
```

### Asset Pipeline Files (What Goes Into `tools/`)

#### `setup-from-client.ts` (~28KB)

One-stop setup from a TurtleWoW client installation:
1. Copies `model.MPQ`, `texture.MPQ`, `patch.MPQ` from client `Data/` → `data/model/`
2. Extracts `patch.MPQ` through `patch-9.MPQ` → `data/patch/`
3. Converts 11 DBC files to JSON (ItemDisplayInfo, CharSections, ChrRaces, etc.)
4. Creates hair texture placeholder directories

**Dependencies:** `@wowserhq/format`, `@wowserhq/stormjs`

#### `build-assets.ts` (~5.4KB)

Orchestrates the 10-step pipeline. Requires `data/model/*.MPQ` and `data/dbc/*.json` from setup.

| Step | Script | Input | Output |
|------|--------|-------|--------|
| 1 | `extract-mpq-items.ts` | model/texture/patch MPQs | `public/items/{weapon,shield,head,shoulder}/` |
| 2 | `extract-mpq-textures.ts` | texture.MPQ | `public/item-textures/` (8 region dirs) |
| 3 | `extract-char-attachments.ts` | Patch M2s + model.MPQ | `data/char-attachments.json` |
| 4 | `convert-model.ts` | Patch M2s (20 races) | `public/models/{race}-{gender}/model.{bin,json}` + `anims.bin` |
| 5 | `convert-textures.ts` | Patch BLPs + texture.MPQ | `public/models/{race}-{gender}/textures/{skin,hair}.tex` |
| 6 | `convert-item-textures.ts` | patch-3 BLPs | `public/item-textures/{Region}/*.tex` |
| 7 | `convert-item.ts` | Patch weapon M2+BLP | `public/items/weapon/{slug}/` |
| 8 | `convert-head-item.ts` | Patch helmet M2+BLP | `public/items/head/{slug}/{race}-{gender}/` |
| 9 | `convert-shoulder-item.ts` | Patch shoulder M2+BLP | `public/items/shoulder/{slug}/{left,right}/` |
| 10 | `build-item-catalog.ts` | IDI.json + assets on disk | `public/item-catalog.json` |

#### `upload-to-r2.ts` (~6.8KB)

Uploads `public/` to Cloudflare R2. Uses S3-compatible API (`@aws-sdk/client-s3`).

Env vars: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`.

Features: concurrent uploads (20), progress + ETA, content-type mapping for `.bin`/`.tex`/`.json`.

#### Other scripts

- `parse-item-db.ts` — Downloads classic-wow-item-db SQL dump, parses to `data/external/items.json` (17,604 items)
- `extract-from-mpq.ts` — Legacy manual extractor (not in pipeline)

### CDN Asset Structure

The `public/` folder (and thus the CDN) has this layout:

```
public/
├── item-catalog.json                          # 8,581 items indexed
├── data/
│   └── HelmetGeosetVisData.json               # Helmet visibility rules
├── models/                                    # 20 character base models
│   └── {race}-{gender}/                       # e.g. human-male, orc-female
│       ├── model.json                         # Manifest: bones, geosets, attachments
│       ├── model.bin                          # Vertex + index buffers (40B/vertex)
│       ├── anims.bin                          # Animation sequences + keyframes
│       └── textures/
│           ├── skin.tex                       # Composited base skin (256x256 RGBA)
│           └── hair.tex                       # Hair texture
├── items/
│   ├── weapon/{slug}/                         # 2,547 weapons
│   │   ├── model.json
│   │   ├── model.bin                          # 32B/vertex (no bone weights)
│   │   └── textures/{variant}.tex
│   ├── shield/{slug}/                         # 369 shields (same structure)
│   ├── head/{slug}/                           # 492 helmets
│   │   ├── {race}-{gender}/                   # Per-race variant
│   │   │   ├── model.json
│   │   │   └── model.bin
│   │   └── textures/{variant}.tex             # Shared across variants
│   └── shoulder/{slug}/                       # 502 shoulders
│       ├── left/                              # Left shoulder model
│       │   ├── model.json
│       │   └── model.bin
│       ├── right/                             # Right shoulder model
│       │   ├── model.json
│       │   └── model.bin
│       └── textures/{variant}.tex
└── item-textures/                             # Body armor textures (no geometry)
    ├── ArmUpperTexture/{name}.tex             # Sleeve textures
    ├── ArmLowerTexture/{name}.tex             # Bracer textures
    ├── HandTexture/{name}.tex                 # Glove textures
    ├── TorsoUpperTexture/{name}.tex           # Chest textures
    ├── TorsoLowerTexture/{name}.tex           # Waist textures
    ├── LegUpperTexture/{name}.tex             # Pant upper textures
    ├── LegLowerTexture/{name}.tex             # Pant lower textures
    └── FootTexture/{name}.tex                 # Boot textures
```

**Total size:** ~600 MB (fits in Cloudflare R2 free tier: 10 GB storage, $0 egress)

### Custom File Formats

#### `.tex` — Raw RGBA texture
```
Bytes 0-1:   uint16 LE width
Bytes 2-3:   uint16 LE height
Bytes 4+:    RGBA pixels (width * height * 4 bytes)
```

#### `model.bin` — Character model (40B per vertex)
```
Per vertex:
  float32[3]  position     (12B)
  float32[3]  normal       (12B)
  float32[2]  uv           (8B)
  uint8[4]    boneIndices  (4B)
  uint8[4]    boneWeights  (4B, normalized to 0-255)
```

#### `model.bin` — Item model (32B per vertex)
```
Per vertex:
  float32[3]  position     (12B)
  float32[3]  normal       (12B)
  float32[2]  uv           (8B)
```

#### `model.json` — Model manifest
```json
{
  "vertexCount": 1234,
  "indexCount": 5678,
  "triangleCount": 1892,
  "vertexBufferSize": 49360,
  "indexBufferSize": 11356,
  "vertexStride": 40,
  "bones": [{ "parent": -1, "pivot": [0,0,0], "rotation": [0,0,0,1], "translation": [0,0,0] }, ...],
  "groups": [{ "id": 0, "indexStart": 0, "indexCount": 300, "textureType": 1 }, ...],
  "attachments": [{ "id": 1, "bone": 42, "pos": [0.1, 0.2, 0.3] }, ...]
}
```

#### `anims.bin` — Animation data
```
Header (28B):
  char[4]   magic         "ANIM"
  uint16    version
  uint16    boneCount
  uint16    seqCount
  uint16    gsCount       (global sequences)
  uint32    seqTableOfs
  uint32    gsTableOfs
  uint32    boneTableOfs
  uint32    indexOfs

Sequence table (20B each):
  uint16    animId
  uint16    subAnimId
  uint32    duration (ms)
  uint32    flags
  uint16    blendTime
  uint16    frequency
  int16     variationNext
  int16     aliasNext

Bone track table (8B each):
  uint8     transInterp, rotInterp, scaleInterp
  int8      transGlobalSeq, rotGlobalSeq, scaleGlobalSeq
  (2 unused bytes)

BoneSeqIndex table (6B per bone*seq):
  uint16    transCount, rotCount, scaleCount

Keyframe data (variable):
  Translation: [uint16 timestamp, float32[3] xyz] × count  (14B each)
  Rotation:    [uint16 timestamp, float32[4] xyzw] × count (18B each)
  Scale:       [uint16 timestamp, float32[3] xyz] × count  (14B each)
```

---

## Target Architecture

### New Repository Structure

```
warcraft-model-viewer/
├── packages/
│   ├── viewer/                              # npm: @anthropic-grins/wow-model-viewer
│   │   ├── src/
│   │   │   ├── index.ts                     # Public API: ModelViewer, types, createCdnResolver
│   │   │   ├── types.ts                     # AssetResolver, BodyArmor, LoadedModel, etc.
│   │   │   ├── ModelViewer.ts               # Turnkey viewer class
│   │   │   ├── loadModel.ts                 # Core engine (from current)
│   │   │   ├── charTexture.ts               # Texture compositing (from current)
│   │   │   └── animation.ts                 # Animation system (from current)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts                   # Library mode build
│   │
│   └── tools/                               # CLI: not published, run from repo
│       ├── scripts/
│       │   ├── setup-from-client.ts
│       │   ├── build-assets.ts
│       │   ├── extract-mpq-items.ts
│       │   ├── extract-mpq-textures.ts
│       │   ├── extract-char-attachments.ts
│       │   ├── convert-model.ts
│       │   ├── convert-textures.ts
│       │   ├── convert-item-textures.ts
│       │   ├── convert-item.ts
│       │   ├── convert-head-item.ts
│       │   ├── convert-shoulder-item.ts
│       │   ├── build-item-catalog.ts
│       │   ├── parse-item-db.ts
│       │   └── upload-to-r2.ts
│       ├── package.json
│       └── README.md                        # How to make your own CDN
│
├── demo/                                    # Example apps (not published)
│   ├── basic/                               # Minimal vanilla JS viewer
│   │   ├── index.html
│   │   └── main.ts
│   ├── chronicle/                           # Chronicle API integration (adapted from /chron)
│   │   ├── index.html
│   │   ├── main.ts
│   │   └── chronEquipmentUI.ts
│   └── vite.config.ts                       # Dev server for demos
│
├── docs/
│   ├── getting-started.md                   # Quick start guide
│   ├── api-reference.md                     # Full ModelViewer API
│   ├── cdn-setup.md                         # How to build & host your own assets
│   ├── asset-format.md                      # .tex, model.bin, model.json, anims.bin specs
│   ├── chronicle-integration.md             # How the Chronicle page works
│   └── learnings.md                         # Kept from current repo — format knowledge
│
├── package.json                             # Workspace root
├── tsconfig.json                            # Shared TS config
└── README.md
```

### File Migration Map

| Current File | Destination | Scope of Change |
|---|---|---|
| `src/loadModel.ts` | `packages/viewer/src/loadModel.ts` | Replace `assetUrl()` with `resolver.resolve()` (~15 calls) |
| `src/charTexture.ts` | `packages/viewer/src/charTexture.ts` | Accept resolver parameter in `loadTexImageData()` |
| `src/animation.ts` | `packages/viewer/src/animation.ts` | Accept resolver parameter in `loadAnimations()` |
| `src/assetBase.ts` | **DELETED** — replaced by `AssetResolver` in `types.ts` | N/A |
| `src/main.ts` | `demo/basic/main.ts` (reference for ModelViewer class) | Becomes demo |
| `src/chron.ts` | `demo/chronicle/main.ts` | Becomes demo |
| `src/chronEquipmentUI.ts` | `demo/chronicle/chronEquipmentUI.ts` | Stays as reference |
| `src/equipmentUI.ts` | Not migrated — catalog-specific UI | Consumer builds their own |
| `src/all.ts` | Not migrated — demo/research only | Drop |
| `src/lab.ts` | Not migrated — experiment | Drop |
| `scripts/*.ts` (all 14) | `packages/tools/scripts/` | No changes — same scripts |
| `scripts/archive/` | Not migrated — historical investigation | Drop |
| `docs/LEARNINGS.md` | `docs/learnings.md` | Keep as format reference |
| `docs/PRD-npm-package.md` | Archive / superseded by this doc | Reference only |
| `e2e/*.spec.ts` | Rewrite against new API | New tests |

### What Does NOT Get Migrated

- `src/all.ts` (428 lines) — 20-race grid, research tool
- `src/lab.ts` (965 lines) — post-processing experiments with tweakpane
- `src/equipmentUI.ts` (401 lines) — DOM-coupled catalog UI. Consumers build their own.
- `scripts/archive/` (13 scripts) — historical investigation scripts
- `docs/archive/` — historical planning docs
- `docs/research/` — foundational research (useful but not shipping)
- `e2e/` — tests need rewriting for new API
- `data/` — raw game data (never shipped)
- All 4 HTML entry points — replaced by demos
- `@tweakpane/core`, `tweakpane` deps — lab.ts only
- `@anthropic-ai/sdk` dep — e2e testing only

---

## Key Abstraction: AssetResolver

### The Problem

Current code uses global mutable state:

```typescript
// assetBase.ts (current)
let _base = '';
let _authCookie = '';
export function setAssetBase(url: string) { _base = url.replace(/\/+$/, ''); }
export function assetUrl(path: string): string { return _base + path; }
```

This breaks with multiple viewer instances, is hard to test, and couples the engine to a specific auth strategy.

### The Solution

```typescript
// types.ts (new)
export interface AssetResolver {
  /** Resolve a relative asset path to a full URL. */
  resolve(path: string): string;
  /** Optional fetch options (auth headers, credentials). */
  fetchOpts?(): RequestInit;
}

/** Simple CDN resolver — prepends base URL. */
export function createCdnResolver(baseUrl: string, opts?: {
  auth?: string;
}): AssetResolver {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    resolve: (path: string) => base ? `${base}${path}` : path,
    fetchOpts: opts?.auth
      ? () => ({
          credentials: 'include' as RequestCredentials,
          headers: { 'Cookie': `chronicle_auth_session=${opts.auth}` },
        })
      : undefined,
  };
}
```

### Migration Diff (Representative)

```typescript
// loadModel.ts — BEFORE
import { assetUrl } from './assetBase';
async function loadTexture(url: string): Promise<THREE.DataTexture> {
  const res = await fetch(assetUrl(url));
  // ...
}
export async function loadModel(modelDir: string, options?: { ... }): Promise<LoadedModel> {
  const [manifestRes, binRes] = await Promise.all([
    fetch(assetUrl(`${modelDir}/model.json`)),
    fetch(assetUrl(`${modelDir}/model.bin`)),
  ]);
  // ...
}

// loadModel.ts — AFTER
import type { AssetResolver } from './types';
async function loadTexture(url: string, resolver: AssetResolver): Promise<THREE.DataTexture> {
  const res = await fetch(resolver.resolve(url), resolver.fetchOpts?.());
  // ...
}
export async function loadModel(
  modelDir: string,
  resolver: AssetResolver,
  options?: { ... },
): Promise<LoadedModel> {
  const [manifestRes, binRes] = await Promise.all([
    fetch(resolver.resolve(`${modelDir}/model.json`), resolver.fetchOpts?.()),
    fetch(resolver.resolve(`${modelDir}/model.bin`), resolver.fetchOpts?.()),
  ]);
  // ...
}
```

### All Fetch Calls That Need Resolver Threading

| File | Function | Current Call | Count |
|------|----------|-------------|-------|
| `loadModel.ts` | `loadTexture()` | `fetch(assetUrl(url))` | called ~4x per model load |
| `loadModel.ts` | `loadModel()` | `fetch(assetUrl(modelDir + '/model.json'))` | 1 |
| `loadModel.ts` | `loadModel()` | `fetch(assetUrl(modelDir + '/model.bin'))` | 1 |
| `loadModel.ts` | `loadHelmetVisData()` | `fetch(assetUrl('/data/HelmetGeosetVisData.json'))` | 1 (cached) |
| `loadModel.ts` | `loadItemModel()` | `fetch(assetUrl(itemDir + '/model.json'))` | 1 per item |
| `loadModel.ts` | `loadItemModel()` | `fetch(assetUrl(itemDir + '/model.bin'))` | 1 per item |
| `charTexture.ts` | `loadTexImageData()` | `fetch(assetUrl(url))` | 1 per texture layer |
| `animation.ts` | `loadAnimations()` | `fetch(assetUrl(modelDir + '/anims.bin'))` | 1 |

**Total: ~15 call sites.** The change is mechanical — add `resolver` parameter, replace `assetUrl(x)` with `resolver.resolve(x)`, add `resolver.fetchOpts?.()` as second arg to `fetch`.

---

## Public API: ModelViewer Class

### `packages/viewer/src/ModelViewer.ts`

This class wraps the scene, camera, controls, and render loop — currently spread across `main.ts` and `chron.ts`.

```typescript
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadModel, LoadedModel, BodyArmor } from './loadModel';
import { loadAnimations, AnimationController } from './animation';
import type { AssetResolver } from './types';

export interface ModelViewerConfig {
  /** DOM element to mount the canvas into. */
  container: HTMLElement;
  /** Asset resolver (use createCdnResolver for simple CDN setup). */
  assets: AssetResolver;
  /** Background color (default: 0x333333). */
  backgroundColor?: number;
}

export interface EquipmentOptions {
  weapon?: { path: string; texture?: string };
  offhand?: { path: string; texture?: string };
  armor?: BodyArmor;
}

export interface AnimationInfo {
  seqIndex: number;
  animId: number;
  subAnimId: number;
  label: string;
  duration: number;
}

export class ModelViewer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private resolver: AssetResolver;

  private currentModel: LoadedModel | null = null;
  private animController: AnimationController | null = null;
  private currentRace: string = '';
  private currentGender: string = '';
  private currentEquipment: EquipmentOptions = {};

  private animFrameId: number = 0;
  private lastFrameTime: number = 0;
  private disposed: boolean = false;

  constructor(config: ModelViewerConfig) { /* ... */ }

  /** Load a character model. Race: 'human', 'orc', etc. Gender: 'male' or 'female'. */
  async loadCharacter(race: string, gender: string): Promise<void> { /* ... */ }

  /** Equip items. Triggers a full model reload with new equipment. */
  async equip(equipment: EquipmentOptions): Promise<void> { /* ... */ }

  /** Clear all equipment. */
  async unequip(): Promise<void> { /* ... */ }

  /** Get available animations for the current model. */
  getAnimations(): AnimationInfo[] { /* ... */ }

  /** Play an animation by sequence index. */
  playAnimation(seqIndex: number): void { /* ... */ }

  /** Play an animation by name (e.g. 'Stand', 'Walk', 'EmoteDance'). */
  playAnimationByName(name: string): void { /* ... */ }

  /** Get the list of supported races. */
  static getRaces(): Array<{ slug: string; label: string }> { /* ... */ }

  /** Clean up all Three.js resources and remove the canvas. */
  dispose(): void { /* ... */ }
}
```

### Usage Examples

**Minimal — render a character:**
```typescript
import { ModelViewer, createCdnResolver } from '@anthropic-grins/wow-model-viewer';

const viewer = new ModelViewer({
  container: document.getElementById('viewer')!,
  assets: createCdnResolver('https://models.chronicleclassic.com'),
});

await viewer.loadCharacter('human', 'male');
```

**With equipment (consumer resolves items themselves):**
```typescript
await viewer.loadCharacter('orc', 'female');

await viewer.equip({
  weapon: {
    path: '/items/weapon/sword-2h-claymore-b-02',
    texture: '/items/weapon/sword-2h-claymore-b-02/textures/main.tex',
  },
  armor: {
    torsoUpperBase: '/item-textures/TorsoUpperTexture/Plate_A_01Silver_Chest_TU',
    armUpperBase: '/item-textures/ArmUpperTexture/Plate_A_01Silver_Sleeve_AU',
    footBase: '/item-textures/FootTexture/Plate_A_01Silver_Boot_FO',
    footGeoset: 3, // heavy boots
    helmet: 'helm-plate-d-02',
    helmetGeosetVisID: [67, 67],
    shoulderSlug: 'plate-a-01silver',
    shoulderHasRight: true,
  },
});
```

**With Chronicle API (what the /chron demo does):**
```typescript
import { ModelViewer, createCdnResolver } from '@anthropic-grins/wow-model-viewer';
import type { BodyArmor } from '@anthropic-grins/wow-model-viewer';

const viewer = new ModelViewer({
  container: document.getElementById('viewer')!,
  assets: createCdnResolver('https://models.chronicleclassic.com'),
});

// Consumer fetches item data from their own API
const item = await fetch(`https://chronicleclassic.com/api/v1/internal/gamedata/display/item/19019`)
  .then(r => r.json());

// Consumer maps API response to viewer equipment format
function mapToEquipment(item: any): EquipmentOptions {
  const slug = item.model_name[0].replace(/\.\w+$/, '').toLowerCase().replace(/_/g, '-');
  return {
    weapon: {
      path: `/items/weapon/${slug}`,
      texture: `/items/weapon/${slug}/textures/${slugify(item.model_texture[0])}.tex`,
    },
  };
}

await viewer.loadCharacter('human', 'male');
await viewer.equip(mapToEquipment(item));
```

**Local development (assets from Vite dev server):**
```typescript
const viewer = new ModelViewer({
  container: document.getElementById('viewer')!,
  assets: createCdnResolver(''), // empty = same-origin relative paths
});
```

---

## Package Build Configuration

### `packages/viewer/package.json`

```json
{
  "name": "@anthropic-grins/wow-model-viewer",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "peerDependencies": {
    "three": ">=0.160.0"
  },
  "devDependencies": {
    "@types/three": "^0.182.0",
    "three": "^0.182.0",
    "typescript": "^5.9.3",
    "vite": "^7.3.1"
  }
}
```

### `packages/viewer/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: (format) => `index.js`,
    },
    rollupOptions: {
      external: ['three', /^three\//],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
      },
    },
    sourcemap: true,
  },
});
```

### `packages/viewer/src/index.ts`

```typescript
// Types
export type { AssetResolver, EquipmentOptions, AnimationInfo, ModelViewerConfig } from './types';
export type { BodyArmor, BoneInfo, LoadedModel } from './loadModel';

// Resolver factory
export { createCdnResolver } from './types';

// Turnkey viewer
export { ModelViewer } from './ModelViewer';

// Low-level API (for advanced consumers who want to manage their own scene)
export { loadModel } from './loadModel';
export { loadAnimations, AnimationController } from './animation';
export { composeCharTexture, loadTexImageData, CharRegion } from './charTexture';
```

### `packages/tools/package.json`

```json
{
  "name": "@anthropic-grins/wow-model-tools",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "setup": "bun run scripts/setup-from-client.ts",
    "build-assets": "bun run scripts/build-assets.ts",
    "upload": "bun run scripts/upload-to-r2.ts"
  },
  "dependencies": {
    "@wowserhq/format": "^0.28.0",
    "@wowserhq/stormjs": "^0.4.1"
  }
}
```

---

## How To Make Your Own CDN

This section documents the complete process for anyone who wants to host their own asset server. This goes into `packages/tools/README.md` and `docs/cdn-setup.md`.

### Prerequisites

- A WoW 1.12.x game client (Turtle WoW, vanilla, Kronos, etc.)
- [Bun](https://bun.sh) runtime (the build scripts use Bun)
- A static file host (Cloudflare R2, AWS S3, GitHub Pages, any HTTP server)

### Step 1: Extract Game Data

```bash
cd packages/tools
bun install

# Point at your game client installation
bun run setup -- /path/to/TurtleWoW
```

This does three things:
1. **Copies MPQ archives** — `model.MPQ`, `texture.MPQ`, `patch.MPQ` → `data/model/`
2. **Extracts patch files** — `patch.MPQ` through `patch-9.MPQ` → `data/patch/` (Character + Item + DBC files only)
3. **Converts DBC to JSON** — 11 database files → `data/dbc/*.json`

Runtime: ~5 minutes. Disk: ~3 GB for raw data.

### Step 2: Convert to Web Format

```bash
bun run build-assets
```

Runs the 10-step pipeline:
1. Extract item models from MPQ archives
2. Extract item textures from MPQ archives
3. Extract character attachment points (helmet positioning)
4. Convert 20 character M2 models → `model.bin` + `model.json` + `anims.bin`
5. Convert character skin + hair BLP textures → `.tex`
6. Convert armor BLP textures → `.tex` (8 body regions)
7. Convert weapon M2 models → web format
8. Convert helmet M2 models → web format (per race-gender)
9. Convert shoulder M2 models → web format (left/right pairs)
10. Build item catalog JSON index

Runtime: ~10-30 minutes. Output: `public/` folder (~600 MB).

### Step 3: Upload to CDN

**Option A: Cloudflare R2 (recommended — free)**

```bash
# Set credentials
export R2_ACCOUNT_ID=your-account-id
export R2_ACCESS_KEY_ID=your-key-id
export R2_SECRET_ACCESS_KEY=your-secret
export R2_BUCKET_NAME=wow-model-viewer

bun run upload
```

Cost: $0/month (R2 free tier: 10 GB storage, no egress fees).

Set up a custom domain in Cloudflare dashboard → R2 → Custom Domains → `assets.yourdomain.com`.

Add CORS headers in R2 bucket settings:
```json
[{
  "AllowedOrigins": ["*"],
  "AllowedMethods": ["GET"],
  "AllowedHeaders": ["*"],
  "MaxAgeSeconds": 86400
}]
```

Cache headers (all game assets are immutable):
```
Cache-Control: public, max-age=31536000, immutable
```

**Option B: Any S3-compatible host**

The upload script uses `@aws-sdk/client-s3`. It works with AWS S3, MinIO, Backblaze B2, DigitalOcean Spaces — anything with an S3-compatible API.

**Option C: Static file server**

Just serve the `public/` directory from any HTTP server:
```bash
# Nginx, Apache, Caddy, GitHub Pages, Netlify, Vercel...
cp -r public/ /var/www/wow-assets/
```

### Step 4: Point the Viewer at Your CDN

```typescript
import { ModelViewer, createCdnResolver } from '@anthropic-grins/wow-model-viewer';

const viewer = new ModelViewer({
  container: document.getElementById('viewer')!,
  assets: createCdnResolver('https://assets.yourdomain.com'),
});

await viewer.loadCharacter('human', 'male');
```

### What's Server-Specific

The model/texture assets are identical across 1.12.x servers. What differs is the **item database** — which items exist and their display IDs.

Turtle WoW has custom items (goblins, blood elves, custom weapons) that don't exist in vanilla. The `item-catalog.json` built by the pipeline reflects what's available in **your extracted game client**.

If you need item-ID → display-ID mapping for a specific server's database, that's your responsibility:
- Use the Chronicle API for Chronicle Classic
- Build a mapping from your server's item database
- Scrape Wowhead / classicdb
- Use the bundled `item-catalog.json` (covers all models extracted from the game client)

---

## Implementation Phases

### Phase 1: Extract Core Engine + AssetResolver

**Goal:** 4 core files in `packages/viewer/src/` with resolver injection. Existing functionality preserved.

**Steps:**
1. Create monorepo structure with `packages/viewer/` and `packages/tools/`
2. Copy `loadModel.ts`, `charTexture.ts`, `animation.ts` → `packages/viewer/src/`
3. Create `types.ts` with `AssetResolver` interface and `createCdnResolver`
4. Replace all `assetUrl()` calls with `resolver.resolve()` (~15 call sites)
5. Delete `assetBase.ts` (no longer needed)
6. Create `index.ts` with all exports

**Verify:** Import the package in a test file, call `loadModel` with a resolver pointing at `public/`, confirm it works.

**Files changed:**
- `loadModel.ts` — add `resolver` parameter to `loadModel()`, `loadTexture()`, `loadItemModel()`, `loadHelmetVisData()`
- `charTexture.ts` — add `resolver` parameter to `loadTexImageData()`
- `animation.ts` — add `resolver` parameter to `loadAnimations()`
- New: `types.ts`, `index.ts`

### Phase 2: ModelViewer Class

**Goal:** Turnkey viewer class that manages scene, camera, controls, render loop, and equipment.

**Steps:**
1. Extract scene setup from `main.ts` into `ModelViewer.ts` constructor
2. Extract `switchModel` into `loadCharacter()` + `equip()`
3. Extract `disposeModel` into `dispose()`
4. Extract `frameCameraOnModel` into auto-framing
5. Handle resize observer (container-based, not window-based)
6. Handle multiple instances (each gets its own renderer/scene)

**Verify:** Create `demo/basic/` that uses `ModelViewer` class to render a character with equipment.

### Phase 3: Tools Package + Demo

**Goal:** Copy all scripts into `packages/tools/`, create demo apps.

**Steps:**
1. Copy all 14 scripts to `packages/tools/scripts/`
2. Create `packages/tools/package.json` with deps
3. Create `demo/basic/` — minimal vanilla JS viewer
4. Create `demo/chronicle/` — adapted from current `/chron` page
5. Create `demo/vite.config.ts` — dev server for demos

**Verify:** `bun run setup` and `bun run build-assets` work from `packages/tools/`. Demos render correctly.

### Phase 4: Library Build + Publish

**Goal:** Vite library mode build, npm publish.

**Steps:**
1. Configure `vite.config.ts` in library mode (externalize Three.js)
2. Generate TypeScript declarations
3. Test: `npm pack` → install in fresh project → renders
4. Publish to npm

**Verify:** `npm install @anthropic-grins/wow-model-viewer three` in a fresh Vite project → renders a character.

### Phase 5: Documentation

**Goal:** README, API reference, CDN setup guide, Chronicle integration guide.

**Steps:**
1. Write `README.md` with quick start
2. Write `docs/api-reference.md` with full ModelViewer API
3. Write `docs/cdn-setup.md` (expanded from section above)
4. Write `docs/asset-format.md` with binary format specs
5. Write `docs/chronicle-integration.md` showing how `/chron` works as a reference

---

## Open Decisions

1. **Package name**: `@anthropic-grins/wow-model-viewer`? `@jollygrin/wow-model-viewer`? `warcraft-model-viewer`?

2. **Repo strategy**: New repo (clean history, no archaeology) vs. refactor in place (preserve git history, continuous deployment)?

3. **React adapter**: Ship `<WowModelViewer />` React component in Phase 4, or defer to Phase 6?
   - Pro: React is the most common framework, adapter is ~50 lines
   - Con: Adds React as optional peer dep, more to maintain

4. **Item catalog**: Should the viewer package know about `item-catalog.json` at all, or is that purely the consumer's domain?
   - Current `/chron` page doesn't use the catalog — it fetches from Chronicle API
   - Current local page does use the catalog via `equipmentUI.ts`
   - Recommendation: Don't include catalog loading in the package. Let consumers handle it.

5. **Texture format**: Keep `.tex` (raw RGBA, simple, no decode step) or convert to WebP/PNG for CDN?
   - `.tex` is ~4x larger than WebP on the wire, but decodes instantly (no CPU decompress)
   - With gzip/brotli transport compression, `.tex` compresses well (~50% reduction)
   - Recommendation: Keep `.tex` for now. Optimize later if bandwidth is a problem.

6. **HelmetGeosetVisData.json**: Currently loaded from CDN path `/data/HelmetGeosetVisData.json`. Options:
   - Keep on CDN (current behavior) — adds one extra fetch per session
   - Bundle into the npm package as a JSON import — ~2.9KB gzipped
   - Recommendation: Bundle it. It's tiny and universal across all 1.12.x servers.

---

## Chronicle API Reference

For consumers who want to integrate with Chronicle Classic's item database (like the `/chron` demo does).

### Endpoint

```
GET https://chronicleclassic.com/api/v1/internal/gamedata/display/item/{itemId}
```

### Response Shape

```typescript
interface ChronicleItem {
  entry: number;              // Item ID (e.g. 19019 for Thunderfury)
  name: string;               // "Thunderfury, Blessed Blade of the Windseeker"
  quality: number;            // 0=Poor, 1=Common, 2=Uncommon, 3=Rare, 4=Epic, 5=Legendary
  item_class: number;         // 2=Weapon, 4=Armor, etc.
  item_subclass: number;      // 7=1H Sword, 8=2H Sword, etc.
  inventory_type: number;     // 13=1H Weapon, 14=Shield, 1=Head, 3=Shoulder, 5=Chest, 7=Legs, 8=Feet, 10=Hands
  sheath: number;             // Sheath position
  display_id: number;         // Display ID (references ItemDisplayInfo)
  model_name: string[];       // ["Sword_1H_Thunderfury.m2"]
  model_texture: string[];    // ["Sword_1H_Thunderfury.blp"]
  geoset_group: number[];     // [0, 0, 0] — for armor geometry overrides
  texture: string[];          // [8 strings] — body region texture names
  inventory_icon: string[];   // Icon filenames
  helmet_geoset_vis: number[];// Helmet visibility bitflags
  geoset_vis_id: number[];    // [maleVisId, femaleVisId] — HelmetGeosetVisData IDs
  ground_model: string;       // Ground drop model
  item_visual: number;        // Enchant visual ID
  flags: number;              // Item flags
}
```

### Mapping API Response to Viewer Equipment

The `/chron` demo's `chronEquipmentUI.ts` shows the full mapping. Key conversions:

**Weapon/Shield:**
```typescript
const slug = item.model_name[0].replace(/\.\w+$/, '').toLowerCase().replace(/_/g, '-');
const texSlug = item.model_texture[0].replace(/\.\w+$/, '').toLowerCase().replace(/_/g, '-');
const dir = item.inventory_type === 14 ? 'shield' : 'weapon';
// path: `/items/${dir}/${slug}`
// texture: `/items/${dir}/${slug}/textures/${texSlug}.tex`
```

**Body armor (chest/legs/boots/gloves):**
```typescript
const TEXTURE_REGION_DIRS = [
  'ArmUpperTexture', 'ArmLowerTexture', 'HandTexture',
  'TorsoUpperTexture', 'TorsoLowerTexture',
  'LegUpperTexture', 'LegLowerTexture', 'FootTexture',
];
function texBase(regionIdx: number, texName: string): string {
  const name = texName.replace(/\.blp$/i, '');
  return `/item-textures/${TEXTURE_REGION_DIRS[regionIdx]}/${name}`;
}
// Chest: armor.torsoUpperBase = texBase(3, item.texture[3])
// Legs:  armor.legUpperBase = texBase(5, item.texture[5])
// etc.
```

**Geoset overrides:**
```typescript
// geoset_group[0] = geometry level (0=none, >0 = override)
// Formula: slotGroup * 100 + value + 1
if (item.geoset_group[0] > 0) {
  armor.sleeveGeoset = item.geoset_group[0] + 1;  // chest sleeves
  armor.footGeoset = item.geoset_group[0] + 1;     // boot coverage
  armor.handGeoset = item.geoset_group[0] + 1;     // glove coverage
}
```

**Helmet:**
```typescript
armor.helmet = slugify(item.model_name[0]);
armor.helmetGeosetVisID = [item.geoset_vis_id[0], item.geoset_vis_id[1]];
armor.helmetTexture = slugify(item.model_texture[0]);
```

**Shoulder:**
```typescript
armor.shoulderSlug = slugify(item.model_name[0].replace(/^[LR]Shoulder_/i, ''));
armor.shoulderHasRight = true;
armor.shoulderTexture = slugify(item.model_texture[0]);
```

### Inventory Type → Slot Mapping

| Inventory Type | Slot | Description |
|---|---|---|
| 1 | head | Helmets |
| 3 | shoulder | Shoulder pads |
| 5, 20 | chest | Chest armor, robes |
| 7 | legs | Leg armor |
| 8 | feet | Boots |
| 10 | hands | Gloves |
| 13, 15, 17, 21, 25, 26 | weapon | 1H/2H weapons |
| 14, 22, 23 | offhand | Shield, offhand, holdable |

---

## Critical Technical Knowledge

### Geoset System

Character models are divided into geoset groups. The viewer selects which geosets to show based on equipment:

| Group | Default | Purpose | Equipment Override |
|---|---|---|---|
| 0 | hairstyle (e.g. 5) | Hair | Helmet → swap to 1 (bald) |
| 1 | 101 | Facial hair 1 | Helmet HelmetGeosetVisData |
| 2 | 201 | Facial hair 2 | Helmet HelmetGeosetVisData |
| 3 | 301 | Facial hair 3 | Helmet HelmetGeosetVisData |
| 4 | 401 | Hands | Gloves → 402 (medium) / 403 (heavy) |
| 5 | 501 | Feet | Boots → 502 (medium) / 503 (heavy) |
| 7 | 701 | Ears | Helmet HelmetGeosetVisData |
| 8 | none | Sleeves | Chest → 802 (fitted) / 803 (armored) |
| 9 | none | Wrists | Gloves → 902 (leather) / 903 (armored) |
| 13 | 1301 | Thigh geometry | Robe → 1302 (robe skirt) |
| 15 | 1501 | Cape/back | Always 1501 (bare back), no cape support |

### Texture Compositing

The character's 256x256 skin atlas is divided into 10 regions. Equipment textures are overlaid onto specific regions:

```
┌──────────┬──────────┐
│ ArmUpper │ TorsoUp  │  0,0 → 255,63
│          │          │
├──────────┼──────────┤
│ ArmLower │ TorsoLow │  64 → 127
│          │          │
├──────────┼──────────┤
│ Hand     │ LegUpper │  128 → 159 / 96 → 159
├──────────┤          │
│ FaceUp   │          │  160 → 191
├──────────┼──────────┤
│ FaceLow  │ LegLower │  192 → 255
│          │          │
│          ├──────────┤
│          │ Foot     │  224 → 255
└──────────┴──────────┘
  0→127      128→255
```

### DataTexture Convention

All textures use `flipY=false` (Three.js DataTexture default). Never use `CanvasTexture` (has `flipY=true` default).

After canvas compositing: `getImageData()` → `new Uint8Array(data.buffer)` → `new THREE.DataTexture(...)`.

### M2 Coordinate System

- **+X** = front (face/nose direction)
- **Y** = left/right
- **+Z** = up (height: 0 = feet, ~2.0 = crown)
- Scene applies `-Math.PI/2` X rotation to convert to Three.js Y-up

### Bone Matrix Composition

```
T(pivot + translation) × R(rotation) × T(-pivot)
```

Where:
- `pivot` = bone rest position in M2 world space
- `rotation` = quaternion (animated per frame)
- `translation` = offset from rest position (animated per frame)

---

## Appendix: Current Dependencies Analysis

### What the npm package needs

| Dependency | Type | Why |
|---|---|---|
| `three` | peerDep | WebGL rendering, SkinnedMesh, Skeleton, BufferGeometry |
| `three/examples/jsm/controls/OrbitControls` | included via three | Camera controls |

That's it. The viewer has **zero runtime dependencies** beyond Three.js.

### What the tools package needs

| Dependency | Type | Why |
|---|---|---|
| `@wowserhq/format` | dep | M2, BLP, DBC binary parsing |
| `@wowserhq/stormjs` | dep | MPQ archive extraction |
| `@aws-sdk/client-s3` | dep | R2/S3 upload (optional, only for upload script) |

### What gets dropped

| Dependency | Why Dropped |
|---|---|
| `tweakpane`, `@tweakpane/core` | lab.ts only — not in package |
| `@anthropic-ai/sdk` | e2e testing only |
| `@playwright/test` | e2e testing (can add back for package tests) |
| `vite` | moves from dep to devDep (build tool, not runtime) |

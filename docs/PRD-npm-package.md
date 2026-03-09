# PRD: WoW Model Viewer npm Package + CDN Architecture

## Problem

The model viewer is a monolithic Vite app with hardcoded asset paths, DOM manipulation, and no separation between engine, UI, and asset delivery. It cannot be embedded in other applications or pointed at different asset sources.

## Goals

1. Publish the viewer as an npm package (`@grins/wow-model-viewer`) usable in React, Svelte, or vanilla JS
2. Decouple asset delivery so the same viewer works against a local dev server or a production CDN
3. Support multiple WoW servers (Turtle WoW, vanilla, Kronos) via swappable item databases
4. Preserve all current functionality: 20 race/gender models, equipment compositing, animations, helmets, shoulders, weapons

## Non-Goals

- Rewriting the rendering engine (Three.js stays)
- Changing asset formats (.tex, .bin, model.json stay as-is)
- Building a full item database UI (consumers build their own)
- Supporting non-1.12.x game versions

---

## Architecture

### Three Layers

```
┌─────────────────────────────────────────────┐
│  Host Application (React/Svelte/vanilla)    │
│  - Provides container element               │
│  - Controls viewer via API                  │
│  - Builds its own UI (or uses built-in)     │
├─────────────────────────────────────────────┤
│  npm Package (@grins/wow-model-viewer)      │
│  - Three.js rendering engine                │
│  - Character + equipment loading            │
│  - Texture compositing                      │
│  - Animation system                         │
│  - Optional built-in equipment UI           │
├─────────────────────────────────────────────┤
│  Asset Delivery (CDN or local dev server)   │
│  - Character models + textures              │
│  - Item models + textures                   │
│  - Armor region textures                    │
│  - Item catalog + server mappings           │
└─────────────────────────────────────────────┘
```

### Package Structure

```
@grins/wow-model-viewer/
├── src/
│   ├── index.ts                 # Public API exports
│   ├── types.ts                 # Shared interfaces (AssetResolver, BodyArmor, etc.)
│   │
│   ├── core/                    # Engine (pure Three.js, no DOM assumptions)
│   │   ├── ModelLoader.ts       # loadCharacter(), loadItemModel()
│   │   ├── CharTexture.ts       # composeCharTexture, loadTexImageData
│   │   ├── Animation.ts         # AnimationController
│   │   └── Skeleton.ts          # buildSkeleton, geoset resolution
│   │
│   ├── viewer/                  # Turnkey viewer class
│   │   ├── ModelViewer.ts       # mount(), dispose(), equip(), setRace()
│   │   └── EquipmentPanel.ts    # Optional built-in equipment UI
│   │
│   └── adapters/                # Framework wrappers
│       ├── react.tsx            # <WowModelViewer /> React component
│       └── vanilla.ts           # createModelViewer(container, config)
│
├── package.json
├── tsconfig.json
└── vite.config.ts               # Library mode build
```

### File Migration Map

| Current | Becomes | Scope of Change |
|---|---|---|
| `src/loadModel.ts` | `src/core/ModelLoader.ts` | Thread `resolver` through fetches |
| `src/charTexture.ts` | `src/core/CharTexture.ts` | Minimal (already takes URLs) |
| `src/animation.ts` | `src/core/Animation.ts` | Thread `resolver` through fetches |
| `src/equipmentUI.ts` | `src/viewer/EquipmentPanel.ts` | Decouple from global DOM |
| `src/main.ts` | `src/viewer/ModelViewer.ts` | Extract scene/camera/controls into class |
| `index.html` | `demo/index.html` | Stays as demo, uses the package |

---

## Key Abstraction: AssetResolver

Single interface that makes CDN vs local interchangeable:

```ts
interface AssetResolverConfig {
  /** Base URL for all assets. Empty string = same-origin (dev). */
  baseUrl: string;
  /** Server ID for item database mapping. */
  server?: string;
}

interface AssetResolver {
  resolve(path: string): string;
}

function createResolver(config: AssetResolverConfig): AssetResolver {
  return {
    resolve: (path: string) =>
      config.baseUrl ? `${config.baseUrl}${path}` : path,
  };
}
```

Every `fetch()` in the engine goes through `resolver.resolve()`:

```ts
// Before (hardcoded):
fetch(`${modelDir}/model.json`)
fetch('/item-catalog.json')
fetch('/data/HelmetGeosetVisData.json')

// After (resolver):
fetch(resolver.resolve(`${modelDir}/model.json`))
fetch(resolver.resolve('/item-catalog.json'))
fetch(resolver.resolve('/data/HelmetGeosetVisData.json'))
```

---

## Public API

### Core: ModelViewer Class

```ts
import { ModelViewer } from '@grins/wow-model-viewer';

const viewer = new ModelViewer({
  container: document.getElementById('viewer')!,
  assets: { baseUrl: 'https://assets.example.com/v1' },
});

await viewer.loadCharacter('human', 'male');

// Equip by slug (universal, server-agnostic)
viewer.equip('weapon', 'arcanite-reaper');
viewer.equip('chest', 'plate-a-01silver');
viewer.equip('helmet', 'helm-plate-d-02');

// Unequip
viewer.unequip('weapon');

// Change character
await viewer.loadCharacter('orc', 'female');

// Animation control
viewer.playAnimation('stand');
viewer.playAnimation('walk');

// Events
viewer.on('loaded', () => {});
viewer.on('error', (err) => {});

// Cleanup
viewer.dispose();
```

### React Adapter

```tsx
import { WowModelViewer } from '@grins/wow-model-viewer/react';

function App() {
  return (
    <WowModelViewer
      assets={{ baseUrl: 'https://assets.example.com/v1' }}
      race="human"
      gender="male"
      equipment={{
        weapon: 'arcanite-reaper',
        chest: 'plate-a-01silver',
      }}
      style={{ width: 600, height: 800 }}
      onLoaded={() => console.log('ready')}
    />
  );
}
```

### Vanilla JS

```ts
import { createModelViewer } from '@grins/wow-model-viewer/vanilla';

const viewer = createModelViewer(document.getElementById('viewer')!, {
  assets: { baseUrl: '' },
  race: 'human',
  gender: 'male',
});
```

### Server-Specific Item Lookup

```ts
const viewer = new ModelViewer({
  container: el,
  assets: {
    baseUrl: 'https://assets.example.com/v1',
    server: 'turtle-wow',
  },
});

// Equip by WoW itemId (resolved via server-specific mapping)
viewer.equipByItemId('weapon', 19019); // Thunderfury
```

---

## CDN Structure

### Asset Layout (mirrors current `public/` directory)

```
https://assets.example.com/v1/
├── catalog.json                           # Master item catalog
├── data/
│   └── HelmetGeosetVisData.json           # DBC reference data
├── models/                                # Character base models
│   └── {race}-{gender}/
│       ├── model.bin
│       ├── model.json
│       ├── anims.bin
│       └── textures/
│           ├── skin.tex
│           └── hair.tex
├── items/                                 # 3D item models
│   ├── weapon/{slug}/
│   │   ├── model.bin
│   │   ├── model.json
│   │   └── textures/{variant}.tex
│   ├── shield/{slug}/...
│   ├── helmet/{slug}/...
│   └── shoulder/{slug}/...
├── item-textures/                         # Body armor region textures
│   ├── ArmUpperTexture/{slug}.tex
│   ├── TorsoUpperTexture/{slug}.tex
│   ├── LegUpperTexture/{slug}.tex
│   └── ...
└── servers/                               # Server-specific item mappings
    ├── turtle-wow.json                    # { itemId → displayId }
    ├── vanilla.json
    └── kronos.json
```

### Cache Strategy

All game assets are immutable. A single cache header for everything:

```
Cache-Control: public, max-age=31536000, immutable
```

Catalog and server mapping files use shorter cache with revalidation:

```
Cache-Control: public, max-age=3600, must-revalidate
```

### CDN Provider: Cloudflare R2

| Metric | Value |
|---|---|
| Storage (current) | ~600 MB |
| Storage (full scale) | 2-3 GB |
| Egress cost | $0.00 (always free) |
| Storage cost | $0.00 (under 10 GB free tier) |
| Estimated monthly cost | $0.00 at hobby scale |

Upload pipeline:

```bash
# Sync assets to R2 (S3-compatible API)
aws s3 sync public/ s3://wow-model-viewer/v1/ \
  --endpoint-url https://{account}.r2.cloudflarestorage.com \
  --cache-control "public, max-age=31536000, immutable"
```

Custom domain: `assets.{yoursite}.com` via Cloudflare DNS.

Alternative: Bunny CDN at ~$0.50/month if simpler setup is preferred.

---

## Dev Server

For local development and testing the package, the existing `public/` folder serves as the asset source. No separate dev server needed.

```ts
// Dev: Vite serves public/ at localhost:5173
const viewer = new ModelViewer({
  container: el,
  assets: { baseUrl: '' },
});

// Prod: same code, different baseUrl
const viewer = new ModelViewer({
  container: el,
  assets: { baseUrl: 'https://assets.example.com/v1' },
});
```

The demo app (`demo/index.html`) lives in the repo but is NOT part of the npm package. It uses the package source directly via Vite, with `baseUrl: ''` pointing at `public/`.

---

## Package Build & Distribution

### package.json

```json
{
  "name": "@grins/wow-model-viewer",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./react": "./dist/adapters/react.js",
    "./vanilla": "./dist/adapters/vanilla.js"
  },
  "files": ["dist"],
  "peerDependencies": {
    "three": ">=0.160.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true }
  }
}
```

### Build

Vite library mode outputs ESM. Three.js is externalized (peer dep — consumer provides it).

```ts
// vite.config.ts (library mode)
export default defineConfig({
  build: {
    lib: {
      entry: {
        index: 'src/index.ts',
        'adapters/react': 'src/adapters/react.tsx',
        'adapters/vanilla': 'src/adapters/vanilla.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['three', 'react', 'react-dom',
                  /^three\//],
    },
  },
});
```

---

## Server-Agnostic Design

### What's shared (all 1.12.x servers)

- Character models (same race/gender meshes)
- Item models (same M2 → bin conversion)
- Armor textures (same BLP → tex conversion)
- DBC reference data (HelmetGeosetVisData, CharSections layout)

### What's server-specific

- **Item database**: itemId → displayId mapping differs per server (Turtle WoW adds custom items)
- **Custom items**: Server-specific models/textures that don't exist in vanilla
- **Available races**: Some servers add races (Turtle WoW has goblins, blood elves)

### Server config file format

```json
// servers/turtle-wow.json
{
  "name": "Turtle WoW",
  "patch": "1.12.x",
  "races": ["human", "orc", "dwarf", "night-elf", "scourge",
            "tauren", "gnome", "troll", "goblin", "blood-elf"],
  "items": {
    "19019": { "displayId": 20190, "name": "Thunderfury" },
    "...": "..."
  }
}
```

The viewer loads this at init, then `equipByItemId()` resolves through it. Consumers who don't need itemId lookup just use `equip(slot, slug)` directly.

---

## Implementation Phases

### Phase 1: Extract Core Engine

- Move `loadModel.ts` → `core/ModelLoader.ts`, thread resolver
- Move `charTexture.ts` → `core/CharTexture.ts`
- Move `animation.ts` → `core/Animation.ts`, thread resolver
- Create `types.ts` with all shared interfaces
- Create `AssetResolver` implementation
- Verify: existing demo app still works with `baseUrl: ''`

### Phase 2: ModelViewer Class

- Extract `main.ts` scene/camera/controls/render loop into `ModelViewer` class
- API: `constructor(config)`, `loadCharacter()`, `equip()`, `dispose()`
- Handle resize, cleanup, multiple instances
- Move demo to `demo/index.html` using the class
- Verify: demo renders identically to current app

### Phase 3: Library Build

- Configure Vite library mode
- Externalize Three.js as peer dep
- Export types properly
- Test: `npm pack` → install in a fresh project → renders

### Phase 4: Framework Adapters

- React: `<WowModelViewer />` component with props → API mapping
- Vanilla: `createModelViewer()` factory function
- Handle mount/unmount lifecycle, prop changes

### Phase 5: CDN Deployment

- Set up Cloudflare R2 bucket
- Upload script (`scripts/upload-cdn.ts`)
- Custom domain + CORS headers
- Test: viewer with `baseUrl` pointing at R2

### Phase 6: Server-Agnostic Item Mapping

- Define server config format
- Build Turtle WoW mapping from existing item database
- Add `equipByItemId()` API
- Add `servers/` directory to CDN

---

## Open Questions

1. **Package name**: `@grins/wow-model-viewer`? `wow-model-viewer`? `warcraft-model-viewer`?
2. **Scope of built-in UI**: Ship the equipment panel as part of the package, or let consumers build their own? (Recommend: ship it as opt-in, since it's useful for demos)
3. **Texture format**: Keep `.tex` (raw RGBA) or convert to WebP for CDN? WebP saves ~50% bandwidth but adds a decode step. Could support both with resolver-level format negotiation.
4. **Item catalog granularity**: One big `catalog.json` (1.7MB) or split per slot (`weapons.json`, `helmets.json`, etc.)?
5. **Shield/weapon in both hands**: Current API only supports one weapon. Dual-wield and shield+weapon needs design.

# 05 - Asset CDN Architecture

## How to Organize and Serve WoW Game Assets

---

## How Wowhead Does It (Reference)

Wowhead serves all model viewer assets through `wow.zamimg.com`:

```
# Viewer JS
https://wow.zamimg.com/modelviewer/classic/viewer/viewer.min.js

# Character models (pre-converted from M2 to custom JSON+binary)
https://wow.zamimg.com/modelviewer/classic/character/{race}/{gender}/model.json

# Item metadata (pre-joined from DBC chain)
https://wow.zamimg.com/modelviewer/live/meta/armor/{slot}/{displayId}.json

# Textures (pre-converted from BLP to PNG)
https://wow.zamimg.com/modelviewer/live/textures/{path}.png
```

**Key insight**: Wowhead does NOT serve raw WoW formats. They run a build-time conversion pipeline:
- M2 -> proprietary optimized JSON+binary format
- BLP -> PNG
- DBC -> pre-joined JSON metadata files per displayId/slot

Everything is static files behind a CDN with aggressive caching.

---

## Three Asset Serving Strategies

### Strategy A: Serve Raw WoW Formats, Decode in Browser

Extract M2/BLP/SKIN files from MPQ, serve as-is. Parse in JavaScript at runtime.

| Pros | Cons |
|------|------|
| Simplest build pipeline | BLP decode is expensive at runtime |
| 1:1 mapping to WoW file structure | M2 binary parsing adds JS complexity |
| All original data preserved | Larger transfer (DXT data doesn't compress well over wire) |
| Libraries exist (@wowserhq/format) | Every client pays parsing cost every time |

**Best for**: Prototyping, research.

### Strategy B: Pre-Convert Everything to Web Formats

Build pipeline converts M2 -> glTF, BLP -> PNG/WebP, DBC -> JSON.

| Pros | Cons |
|------|------|
| Fastest runtime | Cannot dynamically switch geosets in static glTF |
| Standard Three.js loaders (GLTFLoader) | Pre-export every combination = combinatorial explosion |
| Smallest transfer sizes | Conversion pipeline must handle all edge cases |
| No custom parsers in browser | Loses dynamic character assembly |

**Best for**: Static model showcase. NOT practical for equipment dressing room.

### Strategy C: Hybrid Approach (RECOMMENDED)

Pre-convert textures and metadata at build time. Parse models at runtime OR pre-serialize to web-optimized binary.

```
Build Pipeline:
  MPQ -> Extract -> BLP textures -----> PNG/WebP (pre-converted)
                 -> M2 models --------> Custom JSON+Binary (pre-parsed)
                 -> DBC files --------> JSON metadata (pre-joined)

Runtime:
  Browser loads JSON metadata (fast, cacheable)
  Browser loads pre-parsed geometry (ArrayBuffers, zero-parse)
  Browser loads PNG/WebP textures (native image decoding)
  Custom Three.js renderer composites everything
```

This is what Wowhead does. It's the production-grade approach.

---

## Recommended Directory Structure

### Flat structure keyed by displayId (for serving):

```
assets/
  models/
    character/
      human-male.json          # Pre-parsed model manifest
      human-male.buf           # Binary vertex/index buffers
      human-female.json
      human-female.buf
      orc-male.json
      ... (20 race/gender combos)
    item/
      {displayId}.json         # Item model manifest
      {displayId}.buf          # Item model binary data
  textures/
    skin/
      human-male-0.png         # Race-gender-skinColor base skin
      human-male-1.png
      ...
    body-region/
      {textureName}.png        # Equipment body region textures
    item/
      {textureName}.png        # Equipment model textures (weapons, etc.)
    cape/
      {textureName}.png        # Cloak textures
  meta/
    item/
      {displayId}.json         # Pre-joined display info per item
    armor/
      {slot}/
        {displayId}.json       # Slot-specific armor display data
  data/
    display-id-lookup.json     # itemId -> displayId mapping (~200KB)
    char-sections.json         # Character customization textures
    helmet-geoset-vis.json     # Helmet geoset hiding rules
    animation-data.json        # Animation ID -> name/flags
    item-display-info/
      batch-0.json             # displayIds 0-999
      batch-1.json             # displayIds 1000-1999
      ...                      # ~30 batch files instead of 24,000 individual files
```

---

## CDN Architecture Options

### Option 1: Static File Server (nginx/Caddy)

Simplest. Pre-built assets served directly.

```
# Caddy config
assets.yourdomain.com {
    root * /var/www/wow-assets
    file_server {
        precompressed br gzip
    }
    header /assets/* {
        Cache-Control "public, max-age=31536000, immutable"
        Access-Control-Allow-Origin "*"
    }
}
```

**Cost**: $5/month VPS handles this easily.

### Option 2: S3 + CloudFront

Infinite scalability. No server management.

```
S3 Bucket: wow-model-assets
  models/, textures/, meta/

CloudFront Distribution:
  Origin: S3 bucket
  TTL: 365 days (assets are immutable)
  Compress: gzip/brotli
  CORS: Allow-Origin *
```

**Cost**: Storage ~$0.02/GB/month (negligible). Bandwidth: $0.085/GB. At 1000 users/month x 50MB = ~$4/month.

### Option 3: Next.js API Routes (Development Only)

For development, serve from the Next.js app itself:

```
/api/assets/models/[...path]     -> Read from local extracted files
/api/assets/textures/[...path]   -> Convert BLP on-the-fly (cached)
```

**Not for production** -- but useful for rapid development before building the full pipeline.

---

## Build Pipeline

### Phase 1: MPQ Extraction

```bash
# Using mpq-tools (Linux/Mac)
mpqextract Data/model.MPQ -o ./extracted/
mpqextract Data/texture.MPQ -o ./extracted/
mpqextract Data/misc.MPQ -o ./extracted/

# Extract patches in order (later overrides earlier)
mpqextract Data/patch.MPQ -o ./extracted/
mpqextract Data/patch-2.MPQ -o ./extracted/
# ... Turtle WoW patches
```

### Phase 2: DBC -> JSON

```bash
# Using WDBX Editor (GUI) or custom Node.js script
# with @wowserhq/format DBC parser
node scripts/convert-dbc.js ./extracted/DBFilesClient/ ./assets/data/
```

Output:
- `data/item-display-info/*.json` (batched)
- `data/char-sections.json`
- `data/helmet-geoset-vis.json`
- `data/display-id-lookup.json` (joined with SQL dump)

### Phase 3: BLP -> PNG/WebP

```bash
# Batch conversion using @wowserhq/format BLP decoder
node scripts/convert-blp.js ./extracted/ ./assets/textures/
```

### Phase 4: M2 -> Web Binary

```bash
# Parse M2 + SKIN files, serialize to JSON manifest + binary ArrayBuffer
node scripts/convert-m2.js ./extracted/ ./assets/models/
```

### Phase 5: Index Generation

```bash
# Build search indices, asset manifests, texture path lookups
node scripts/build-index.js ./assets/
```

---

## Compression Analysis

| Format | Raw Size | gzip | brotli | Notes |
|--------|----------|------|--------|-------|
| M2 binary | 100% | ~60-70% | ~50-60% | Binary compresses moderately |
| BLP (DXT) | 100% | ~95% | ~93% | Already GPU-compressed, barely helps |
| PNG texture | ~40% of BLP | ~38% | ~36% | PNG has internal compression |
| WebP texture | ~25% of BLP | ~24% | ~23% | Best texture compression |
| JSON metadata | 100% | ~15-20% | ~10-15% | JSON compresses extremely well |
| Binary vertex buffers | ~50% of M2 | ~40% | ~35% | Stripped to geometry only |

**Key takeaway**: Convert BLP -> WebP, serve binary buffers with brotli. Best size + fastest loading.

---

## Caching Strategy

```
# Immutable assets (models, textures) - cache forever
Cache-Control: public, max-age=31536000, immutable

# Metadata (could be updated if we fix errors)
Cache-Control: public, max-age=86400

# Display ID lookup (updated as items added)
Cache-Control: public, max-age=3600

# Application code (changes frequently)
Cache-Control: public, max-age=3600
```

Use **content-hash filenames** for long-term caching:
```
textures/item-20190-a3f4b2.webp
```

### Client-Side Persistent Cache (IndexedDB)

Store decoded model data in IndexedDB for repeat visitors:

```typescript
async function getCachedModel(displayId: number): Promise<ModelData | null> {
  const db = await openDB('wow-model-cache', 1);
  return db.get('models', displayId);
}
```

---

## Lazy Loading Strategy

```
INITIAL PAGE LOAD (~630KB):
  1. Viewer JavaScript (~200KB gzipped)
  2. display-id-lookup.json (~30KB gzipped)
  3. Default character model (Human Male, ~300KB)
  4. Default skin texture (~100KB)

ON EQUIP ITEM (~100-200KB per item):
  1. Lookup displayId (instant, in-memory)
  2. Fetch item metadata JSON (~1KB)
  3. Fetch item textures (~50-100KB each)
  4. If weapon/helm/shoulder: fetch item model (~30-100KB)

ON RACE/GENDER CHANGE (~400KB):
  1. Fetch new character model (~300KB)
  2. Fetch new skin texture (~100KB)
  3. Re-apply all equipped items (textures already cached)
```

### Preloading Priority

```typescript
const PRELOAD_PRIORITY = [
  'human-male',       // Default, most common
  'human-female',
  'nightelf-female',  // Very popular
  'undead-male',
  // Rest loaded on demand
];
```

---

## Asset Size Summary

| Category | Raw (from MPQ) | Web-Ready |
|----------|---------------|-----------|
| 16 character models | ~50 MB | ~5 MB |
| Character skin textures | ~200 MB | ~40 MB (WebP) |
| Item models (~7,000) | ~500 MB | ~70 MB |
| Item textures | ~800 MB | ~150 MB (WebP) |
| Body region textures | ~400 MB | ~80 MB (WebP) |
| DBC metadata | ~50 MB | ~3 MB (JSON gzipped) |
| **Total** | **~2 GB** | **~350 MB (WebP)** |

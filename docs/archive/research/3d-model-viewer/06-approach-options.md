# Implementation Approach Options

## Option A: wow-model-viewer + CORS Proxy (RECOMMENDED)

### How It Works
1. Install `wow-model-viewer` npm package
2. Build a Next.js API route proxy for `wow.zamimg.com`
3. Add `displayId` to our item data (from Turtle-WOW-DBC)
4. Create a React component that wraps the viewer
5. Feed it race/gender + equipped items as `[slot, displayId]` pairs
6. Integrate with level scrubber

### Pros
- **Lowest effort** -- Wowhead handles ALL rendering complexity
- **Highest quality** -- same models as Wowhead.com
- **Proven** -- the deprecated version of this app used this exact approach
- **Full equipment support** -- texture compositing, geoset switching, model attachments all handled
- **Animations** -- idle animation works out of the box

### Cons
- **jQuery dependency** (can be loaded dynamically)
- **CORS proxy required** (adds server load, latency)
- **Dependent on Wowhead** -- if they change their CDN/viewer, things break
- **No Turtle WoW custom models** -- items with custom display IDs won't render
- **Heavy payload** -- viewer.min.js + model data is significant
- **Legal grey area** -- using Wowhead's CDN at scale

### Estimated Effort
- Add displayId to data pipeline: 1-2 days
- CORS proxy route: 0.5 days
- React wrapper component: 1-2 days
- Level scrubber integration: 1 day
- **Total: ~4-6 days**

---

## Option B: Wowhead Dressing Room Iframe

### How It Works
1. Construct Wowhead dressing room URL with pre-equipped items
2. Embed in an iframe

### Pros
- **Absolute minimum effort**
- **Best rendering quality** (it IS Wowhead)
- **No proxy needed**

### Cons
- **Zero control** over styling, camera, animations
- **Wowhead branding/ads** in the frame
- **May violate Wowhead ToS**
- **URL construction** for equipped items may not work for all cases
- **Responsive design** issues with iframes
- **No programmatic control** (can't react to level scrubber changes smoothly)

### Estimated Effort
- URL construction + iframe component: 0.5 days
- Level scrubber integration: 1 day (URL updates on each change)
- **Total: ~1-2 days** (but very limited)

---

## Option C: Custom Three.js Renderer

### How It Works
1. Use `three-m2loader` or build custom M2 parser
2. Extract model data from game files (via wow.export or MPQ extraction)
3. Convert to web-friendly format (glTF or custom binary)
4. Build equipment compositing system (texture overlays, geoset switching, attachment points)
5. Host all model assets ourselves

### Pros
- **Full control** over rendering, camera, styling
- **Self-hosted** -- no external dependencies
- **Can support Turtle WoW custom models** (extract from their MPQ patches)
- **No CORS issues**
- **Could be truly unique** -- custom animations, effects, camera angles

### Cons
- **Massive effort** -- implementing the equipment rendering pipeline is the hard part
- **Need to understand** geoset system, texture compositing, attachment points
- **Asset pipeline** -- need to extract, convert, and host thousands of model files
- **Performance tuning** -- WebGL optimization for mobile
- **Ongoing maintenance** -- any bugs in model rendering are on us

### Estimated Effort
- M2 parser / loader: 2-3 weeks
- Equipment rendering pipeline: 2-4 weeks
- Asset extraction + conversion pipeline: 1-2 weeks
- Character model with equipment: 1-2 weeks
- Polish and optimization: 1-2 weeks
- **Total: ~2-3 months**

---

## Option D: Pre-Exported Static glTF Models

### How It Works
1. Use wow.export to batch-export character models with equipment as glTF
2. For each race/gender, export base model
3. Use Google's `<model-viewer>` web component to display
4. When equipment changes, swap to pre-rendered model or update textures

### Pros
- **Standard format** (glTF) -- excellent tooling and ecosystem
- **Good performance** -- optimized for web
- **No runtime model parsing**
- **Could use Google's model-viewer** for nice UX

### Cons
- **Pre-rendering problem** -- can't pre-export every possible equipment combination
- **model-viewer doesn't support** merging multiple glTF files (equipment as separate models)
- **Would need custom Three.js** anyway for dynamic equipment changes
- **Huge storage** if pre-rendering many combinations

### Estimated Effort
- Would likely collapse into Option C once you realize you need dynamic equipment
- **Not recommended as standalone approach**

---

## Option E: Hybrid (Recommended Evolution Path)

### Phase 1 (Ship fast): Option A -- wow-model-viewer + proxy
- Get 3D viewer working with Wowhead's engine
- Covers ~86% of items (vanilla display IDs)
- Show item icon fallback for Turtle WoW custom items
- Estimated: ~1 week

### Phase 2 (Improve): Add displayId data enrichment
- Scrape/build complete itemId -> displayId lookup
- Identify which items are custom vs vanilla
- Show clear UI indication for items without 3D support

### Phase 3 (If needed): Custom renderer for missing models
- Only if Turtle WoW custom items are important enough
- Extract custom assets from MPQ patches
- Either extend Option A or build partial Option C

## Decision Matrix

| Criteria | A (Wowhead) | B (Iframe) | C (Custom) | D (Static) |
|----------|-------------|------------|------------|------------|
| Time to ship | 1 week | 2 days | 2-3 months | N/A |
| Rendering quality | High | Highest | Medium-High | Medium |
| Equipment support | Full | Full | Need to build | Limited |
| Custom TW items | No | No | Yes | Maybe |
| Maintenance | Medium | Low | High | High |
| Independence | Low | Very Low | High | High |
| Mobile performance | Good | OK | Varies | Good |
| Legal risk | Low-Medium | Low | None | None |

# Ralph Scope: Fix Leg Geometry

## Goal

Eliminate the massive hip wing protrusions and dark crotch gap visible in the current render. These are the two dominant visual problems — the model looks broken at the legs.

## How to Validate

After every change, run `/e2e-eval` which builds the project, runs Playwright tests, and takes screenshots. The test captures five views:

1. `screenshots/human-male-front-test.png` — front view (full body)
2. `screenshots/human-male-back-test.png` — back view (shoulders, spine)
3. `screenshots/human-male-rear-quarter-test.png` — 3/4 rear view (catches waist flaring)
4. `screenshots/human-male-top-back-test.png` — top-down back view (catches neck hole)
5. `screenshots/human-male-legs-test.png` — close-up front legs view (primary eval target)

Evaluate ALL FIVE screenshots every time. The legs close-up is the PRIMARY view for this task.

## Current State

- Upper back hole: FIXED (neck patch)
- Hip wing protrusions: FIXED — removed all vertex manipulation, stripped geoset 1102
- Dark crotch gap: FIXED — was caused by vertex snapping, eliminated by removing snapping
- Kneepad seams: N/A — kneepads removed (902/903 are armor, not bare skin)
- Boot-like knees: FIXED — switched from 502 (boots) to 501 (bare feet)
- Missing upper thighs: FIXED — constant-width thigh bridge tubes from Z=0.58 to Z=0.85
- Waist skirt: REDUCED — removed equipment geosets, remaining shape is body mesh's own bottom lip
- Bridge widening: ABANDONED — 6 approaches tried (Y-clamping, step easing, panels), all create visible artifacts. Constant-width is optimal.
- Hip shadow line / body lip: KNOWN LIMITATION — body mesh bottom edge at Z 0.72-0.84 creates a visible trapezoidal shape. Requires texture compositing (CharSections underwear) to fully eliminate. This is the geometric limit.

## Key Files

- `src/loadModel.ts` — Model loading, geoset filtering, material setup, thigh bridge geometry
- `src/main.ts` — Scene, camera, lighting
- `e2e/human-male.spec.ts` — Playwright test with camera views
- `docs/LEARNINGS.md` — All findings so far

## Current Technique (in loadModel.ts)

Clean rendering with NO vertex manipulation:
- All skin geosets merged into a single draw call (shared InterleavedBuffer)
- MeshLambertMaterial with DoubleSide, polygonOffset -1 (renders in front of bridge)
- Naked character geosets: 0, 5, 101, 201, 301, 401, 501, 701, 1002
- Equipment geosets removed: 502 (boots), 902/903 (kneepads), 1102 (pants)
- Separate hair mesh with hair texture
- Neck patch fills intentional back-of-neck hole
- Thigh bridge: two constant-width tubes (matching 501 top cross-section) from Z=0.58 to Z=0.85, with 4-quad crotch bridge connecting inner vertices at top ring. No front/back panels, no widening. Bridge renders behind body (polygonOffset +1). Body mesh lip remains visible — requires texture compositing.

## What Was Tried

### Vertex manipulation approaches (ALL FAILED)
1. 55% centroid shrink — black gaps between legs
2. Normal-based vertex snapping — eliminated skirt but created hip wings
3. Stretch ratio triangle culling (3x) — reduced wings but remnants + crotch gap
4. Angular-aware vertex projection — wide horizontal shelf (body wider than geoset)
5. X-direction clamping — still visible skirt + gap

**Key insight: WoW does NO vertex manipulation. The vertex snapping was CAUSING the problems.**

### Geoset selection approach (SUCCESS)
- Discovered correct WoW default formula: `enabled_meshId = groupBase + geosetGroupValue + 1`
- Switched 501→502 (double the leg geometry), confirmed 902 as correct default
- Removed 1102 entirely (all flare, no fill)
- Used 902+903 together to bridge knee gap

### Bridge widening approaches (ALL FAILED — see LEARNINGS.md for full details)
6 approaches tried to widen the bridge top to cover the body mesh lip:
- Y-clamping body + wide bridge → hexagonal band (body narrower than bridge)
- Swapping polygonOffset → bridge extends beyond body above lip zone
- Narrow bridge under lip → black gap between lip and bridge
- 3-keyframe with mid ring → visible horizontal bar at mid ring widening
- Step easing + panels → disc shape visible edge-on as horizontal line
- **Constant-width tubes (no widening) → BEST RESULT** — no bridge artifacts

**Key insight: polygonOffset only helps at OVERLAPS. Where bridge geometry extends beyond the body mesh edge, there's no body triangle to occlude it. Every widening approach creates edges visible beyond the body silhouette. Constant-width is the geometric optimum.**

## Tasks

### 1. Fix hip wing protrusions — DONE
Solved by removing all vertex manipulation.

### 2. Fix dark crotch gap — DONE
Solved by removing vertex snapping (which was causing it).

### 3. Fix kneepad seams — ACCEPTED AS-IS
Minor shading difference. Not worth addressing without texture compositing.

## Constraints

- NEVER commit — only the human will commit manually
- NEVER read binary files (.m2, .blp, .skin) directly with the Read tool
- Use `npm run build` to rebuild after code changes
- Record all findings in `docs/LEARNINGS.md`
- Keep changes minimal — one focused change per iteration

## Research Tasks

Research tasks produce LEARNINGS entries, not code changes.

### R1. (template)
- Question: <specific question to answer>
- Sources to check: <repos, wikis, docs>
- Done when: <what constitutes a sufficient answer>

Example:
### R2. Research: WoW texture compositing pipeline
- Question: How does the WoW client composite CharSections skin layers into a single atlas?
- Sources to check: wowdev.wiki CharSections, WoWModelViewer source (CharTexture.cpp), wowserhq/scene texture code
- Done when: We know the compositing order, layer regions, and blending modes

## Quality Bar

- tsc --noEmit passes
- npm run build succeeds
- e2e test passes (`npx playwright test e2e/human-male.spec.ts`)
- Screenshots compared to reference and improvement noted

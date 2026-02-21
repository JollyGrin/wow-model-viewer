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
- Kneepad seams: ACCEPTABLE — minor shading difference, not a priority
- Upper thigh gap: KNOWN LIMITATION — body mesh has no geometry from Z 0.10-0.70, WoW fills this with texture compositing. Acceptable until compositing is implemented.

## Key Files

- `src/loadModel.ts` — Model loading, geoset filtering, material setup, vertex snapping logic
- `src/main.ts` — Scene, camera, lighting
- `e2e/human-male.spec.ts` — Playwright test with camera views
- `docs/LEARNINGS.md` — All findings so far

## Current Technique (in loadModel.ts)

Clean rendering with NO vertex manipulation:
- All visible geosets merged into a single draw call (shared InterleavedBuffer)
- Single MeshLambertMaterial with DoubleSide, no polygonOffset
- Correct WoW default geosets: 0, 5, 101, 201, 301, 401, 502, 701, 902, 903, 1002
- Geoset 1102 removed (all flare geometry, no fill)
- Separate hair mesh with hair texture
- Neck patch fills intentional back-of-neck hole

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

# Ralph Scope: Fix Upper Thigh Gap

## Goal

Fill the visible black gap between the body mesh waist (Z ~0.72) and the knee/leg geometry (geosets 903+502). The reference shows continuous skin from waist to feet — our render has a hole in the upper thigh region.

## How to Validate

After every change, run `/e2e-eval` which builds the project, runs Playwright tests, and takes screenshots. The test captures five views:

1. `screenshots/human-male-front-test.png` — front view (full body)
2. `screenshots/human-male-back-test.png` — back view (shoulders, spine)
3. `screenshots/human-male-rear-quarter-test.png` — 3/4 rear view (catches waist flaring)
4. `screenshots/human-male-top-back-test.png` — top-down back view (catches neck hole)
5. `screenshots/human-male-legs-test.png` — close-up front legs view (primary eval target)

Evaluate ALL FIVE screenshots every time. The legs close-up is the PRIMARY view for this task.

Compare to reference: `screenshots/REFERENCE/human-male-front.png`

## Current State (2026-02-26)

### Working
- Upper back hole: FIXED (neck patch geometry)
- Hair: Working (hairstyle 5, dark brown braids)
- Skin texture: Composited from CharSections (base + face + underwear)
- Lighting: Warm-toned MeshLambertMaterial, matches reference
- All other races load (20 race/gender combos)

### The Problem
Body mesh has ZERO vertices from Z 0.20 to Z 0.70 (entire thigh region). Current geoset coverage:

| Geometry | Z range | Tris | Visual |
|----------|---------|------|--------|
| Body (0) | 0.72 → 1.96 | 620 | Torso, waist, head |
| 903 (upper legs) | 0.49 → 0.73 | 64 | Kneepads — NOT full thigh wrap |
| 502 (legs) | 0.13 → 0.61 | 142 | Lower legs + feet |
| **GAP** | **~0.61 → 0.72** | **0** | **Black hole (upper thighs)** |

903 only reaches body mesh at a few vertices near Z 0.73 — doesn't form a complete ring. The gap is clearly visible in the screenshot the user provided.

In the WoW client, this gap is hidden by:
1. Underwear texture composited onto the skin atlas (paint continuity across the seam)
2. The geosets sharing boundary vertices (stitched mesh at edges)
3. Equipment geosets (pants, robes) covering the area

## Key Files

- `src/loadModel.ts` — Model loading, geoset filtering, material setup, neck patch
- `src/main.ts` — Scene, camera, lighting
- `e2e/human-male.spec.ts` — Playwright test with camera views
- `docs/LEARNINGS.md` — All findings (500+ lines, check before attempting anything)

## Current Geosets (in loadModel.ts DEFAULT_GEOSETS)

```
0     — body mesh (torso, waist, head)
5     — hairstyle 4 (long braids)
101   — facial 1 default
201   — facial 2 default
301   — facial 3 default
401   — bare hands
502   — legs (Z 0.13–0.61)
701   — ears
903   — upper legs (Z 0.49–0.73, kneepads)
1002  — undershirt (Z 0.93–1.11)
```

## What Was Already Tried (DO NOT REPEAT)

See docs/LEARNINGS.md "Approaches Summary > Leg Geometry" for the full table of 17 failed approaches. Key takeaways:

1. **NO vertex manipulation** — WoW doesn't do it, and every approach (snapping, shrinking, clamping) creates artifacts
2. **NO bridge widening** — 6 approaches all created visible shelves/bars/discs
3. **Constant-width bridge tubes** were the best geometric approach (removed when we switched to 903)
4. **Geoset 1102 is ALL flare** — cannot fill the gap, only makes it worse

## Constraints

- NEVER commit — only the human will commit manually
- NEVER read binary files (.m2, .blp, .skin) directly with the Read tool
- Use `npm run build` to rebuild after code changes
- Record all findings in `docs/LEARNINGS.md`
- Keep changes minimal — one focused change per iteration
- Take a screenshot BEFORE and AFTER every code change

## Quality Bar

- tsc --noEmit passes
- npm run build succeeds
- e2e test passes (`npx playwright test e2e/human-male.spec.ts`)
- Screenshots compared to reference and improvement noted

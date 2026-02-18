# Ralph Scope: Fix Upper Legs & Upper Back

## Goal

Fix the two remaining visible geometry issues on the textured human male model.

## How to Validate

After every change, run `/e2e-eval` which builds the project, runs Playwright tests, and takes screenshots. The test captures four views:

1. `screenshots/human-male-front-test.png` — front view (legs, torso, face)
2. `screenshots/human-male-back-test.png` — back view (shoulders, spine)
3. `screenshots/human-male-rear-quarter-test.png` — 3/4 rear view (catches side-profile issues like waist flaring)
4. `screenshots/human-male-top-back-test.png` — top-down back view (catches upper back hole between shoulders)

Evaluate ALL FOUR screenshots every time. Check for regressions in ALL views, not just the one relevant to the current task.

## Current State

- Model renders with textured skin, hair, warm lighting, correct background
- Clothing geosets (1002, 1102, 903) are shrunk toward body centroid with radius clamping
- Two visible issues remain: upper back hole between shoulders, dark patches on upper thighs

## Key Files

- `src/loadModel.ts` — Model loading, geoset filtering, material setup, clothing shrink logic
- `src/main.ts` — Scene, camera, lighting
- `e2e/human-male.spec.ts` — Playwright test that takes front+back screenshots
- `docs/LEARNINGS.md` — All findings so far (READ THIS FIRST)

## Tasks

### 1. Fix upper back hole

- **Root Cause:** There is a triangular hole visible between the shoulders under the neck from behind. The body mesh (geoset 0) has sparse geometry in that region, and geoset 1002 (undershirt) is supposed to fill it but may not have sufficient coverage.
- **Failed approach:** Moving 1002 from CLOTHING_GEOSETS to BODY_LAYER_GEOSETS — this stopped the shrink which caused the undershirt to flare out at the waist like a skirt, creating a worse regression. Reverted.
- **Approach A:** Keep 1002 in CLOTHING_GEOSETS (shrunk) but switch it to DoubleSide rendering so back-facing triangles in the upper back are visible. This preserves the waist shrink while fixing the back hole.
- **Approach B:** Give 1002 its own treatment — shrink only the lower portion (waist-height vertices) while leaving upper back vertices unshrunk, and render DoubleSide.
- **Approach C:** Investigate if the hole is actually in the body mesh (geoset 0) itself and 1002 doesn't cover it — may need to check what geometry actually exists in the hole region.
- **Acceptance:** No visible hole in top-down back view (`human-male-top-back-test.png`). No waist flaring in rear-quarter view. Compare to references.
- **Priority:** high

### 2. Fix upper leg dark patches

- **Root Cause:** Clothing geosets (1102, 903) have different normals/UVs from the body mesh, creating visible dark rectangular bands on the upper thighs even after shrinking toward the body.
- **Approach A — Depth-only clothing:** Make clothing a "depth-only" layer — render to depth buffer but not to color buffer (`colorWrite: false`). Body `polygonOffset` pushes it forward where body geometry exists; clothing just fills depth holes invisibly. This means clothing geometry plugs gaps without contributing its own (differently-shaded) pixels.
- **Approach B — Normal copying (fallback):** If depth-only creates new artifacts, try copying normals from the nearest body vertex to each clothing vertex so their shading matches the body surface.
- **Acceptance:** Front view upper thighs have smooth continuous skin tone, no dark rectangular bands. Compare to `screenshots/REFERENCE/human-male-front.png`.
- **Priority:** high

## Constraints

- NEVER commit — only the human will commit manually
- NEVER read binary files (.m2, .blp, .skin) directly with the Read tool
- Use `npm run build` to rebuild after code changes
- Use `npx playwright test e2e/human-male.spec.ts` to take screenshots
- Always compare screenshots against `screenshots/REFERENCE/human-male-front.png` and `screenshots/REFERENCE/human-male-back.png` using the Read tool
- Record all findings in `docs/LEARNINGS.md`
- Keep changes minimal — one focused change per iteration

## Quality Bar

- tsc --noEmit passes (ignore convert-textures.ts type error on Blp.load — runtime works fine)
- npm run build succeeds
- e2e test passes (`npx playwright test e2e/human-male.spec.ts`)
- Screenshots compared to reference and improvement noted

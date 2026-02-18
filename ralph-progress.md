# Ralph Progress Log

## [2026-02-18] Eval improvement: Added 3/4 rear and top-down camera views
- Status: done
- Files changed: e2e/human-male.spec.ts
- Notes: Front and back views were insufficient — they hide side-profile issues (waist flaring) and upper-back holes. Added rear-quarter view (camera at -2, 1.3, 2) and top-down back view (camera at -1.5, 2.8, 0) to catch these issues. All four views must be checked for regressions on every change.

## [2026-02-18] Task: Fix upper back hole — Attempt 1 (REVERTED)
- Status: reverted
- Files changed: src/loadModel.ts (reverted)
- Decisions: Tried moving 1002 from CLOTHING_GEOSETS to BODY_LAYER_GEOSETS.
- Notes: FAILED. Removing the shrink caused the undershirt to flare out at the waist like a skirt — a clear regression visible in side profile. The back hole also was not actually fixed (visible from top-down view). The straight-on back view hid both problems. Reverted to baseline.

## [2026-02-18] Task: Fix upper back hole — Attempt 2 (SUCCESS)
- Status: done
- Files changed: src/loadModel.ts
- Decisions: Used geometry analysis to discover the root cause and generated a patch mesh.
- Notes: Investigated approaches A (DoubleSide on 1002) and B (selective unshrink) — both failed because the hole is NOT caused by culling or shrinking. Analysis revealed:
  1. Geoset 1002 only covers Z=[0.927, 1.105] — too low for the neck hole
  2. Body mesh (geoset 0) has 12-vertex boundary loop forming a hole at Z=[1.58, 1.81] — the entire back of the neck
  3. This hole is intentional in the WoW model, normally covered by hair/armor
  4. Solution: generated a 12-triangle fan patch from the centroid to fill the boundary loop, using UVs sampled from nearest body vertices for proper skin texturing
  5. Also split geoset 1002 into its own UNDERSHIRT_GEOSETS set with DoubleSide rendering (belt-and-suspenders approach)
  6. Small dark area remains where head meets hair (separate boundary loop at Z=1.81-1.92, covered by hairstyle geoset)

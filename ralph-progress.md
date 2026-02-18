# Ralph Progress Log

## [2026-02-18] Eval improvement: Added 3/4 rear and top-down camera views
- Status: done
- Files changed: e2e/human-male.spec.ts
- Notes: Front and back views were insufficient — they hide side-profile issues (waist flaring) and upper-back holes. Added rear-quarter view (camera at -2, 1.3, 2) and top-down back view (camera at -1.5, 2.8, 0) to catch these issues. All four views must be checked for regressions on every change.

## [2026-02-18] Task: Fix upper back hole — Attempt 1 (REVERTED)
- Status: reverted
- Files changed: src/loadModel.ts (reverted)
- Decisions: Tried moving 1002 from CLOTHING_GEOSETS to BODY_LAYER_GEOSETS.
- Notes: FAILED. Removing the shrink caused the undershirt to flare out at the waist like a skirt — a clear regression visible in side profile. The back hole also was not actually fixed (visible from top-down view). The straight-on back view hid both problems. Reverted to baseline. Need a different approach — possibly DoubleSide rendering for 1002 while keeping it in CLOTHING_GEOSETS (shrunk), or selective shrink (only lower vertices).

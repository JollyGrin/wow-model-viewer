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

## [2026-02-19] Task: Fix upper leg dark patches
- Status: done
- Files changed: src/loadModel.ts
- Decisions: Used Approach B (normal copying) + switched clothing to DoubleSide.
- Notes: For each clothing vertex, found the nearest body vertex and copied its normal (nx, ny, nz) to the clothing vertex data. This makes the clothing shading match the body surface, eliminating the dark rectangular bands caused by different normals. Also switched clothing material from FrontSide to DoubleSide so back-facing triangles in body holes are visible, reducing see-through gaps. Result: front view upper thighs have much more continuous skin tone, dark bands largely eliminated. Some seam lines remain from geometry gaps between body edge and shrunk clothing, but the overall appearance is significantly improved. No regressions in other views — neck patch intact, waist band acceptable.

## [2026-02-19] Task: Add close-up legs camera view
- Status: done
- Files changed: e2e/human-male.spec.ts
- Notes: Added 5th camera view at (1.5, 0.55, 0) targeting (0, 0.55, 0) — close-up front legs capturing waist-to-feet area. Clearly shows all three leg problems: waist skirt, black gaps between body and shrunk clothing, and knee seams. This view is the primary eval target for the upper leg fix task.

## [2026-02-19] Task: Fix upper leg gaps and skirt
- Status: done
- Files changed: src/loadModel.ts, docs/LEARNINGS.md
- Decisions: Replaced 55% radial shrink with normal-based vertex snapping.
- Notes: The 55% shrink was the root cause of massive black see-through gaps. Removing shrink fixed gaps but revealed waist skirt (clothing extending beyond body silhouette). Tried 5 approaches:
  1. Uniform 10% shrink — skirt barely affected
  2. Boundary clamp (maxR per height) — clothing within body maxR, no effect
  3. Face culling (scalar maxR) — damaged kneepads, skirt untouched
  4. Face culling (directional maxR, 12 sectors) — more kneepad damage, skirt still there
  5. **Normal-based vertex snapping (SUCCESS)** — for each clothing vertex, find nearest body vertex. If dot(displacement, body_normal) > 0 (vertex outside body surface), snap to body position. Leaves hole-filling vertices untouched.

  Result: waist skirt eliminated, black gaps gone, continuous skin tone at upper thighs. Minor triangle artifacts remain at hip sides and knees. No regressions in other views — neck patch and upper back intact.

## [2026-02-19] Task: Fix hip wing protrusions — Attempt (BLOCKED)
- Status: blocked
- Files changed: src/loadModel.ts (reverted to best state)
- Decisions: Tried 3 variations, all worse than baseline hard snap with dot > 0.001.
- Notes: Attempted:
  1. **Smooth lerp + distance guard (dist < 0.15)** — waist skirt returned because distance guard prevented skirt vertices from snapping. Major regression.
  2. **Higher dot threshold (0.02)** — no visible change vs dot > 0.001, hip wings identical.
  3. **Normal projection (subtract dot*normal)** — severe distortion because body normals at hole boundaries point in inconsistent directions. Much worse than hard snap.

  Root cause analysis: the hip wings are caused by triangle distortion at the clothing/body boundary where some vertices snap and neighbors don't. All vertex-level approaches (threshold tuning, lerp, projection) trade off between skirt elimination and wing artifacts. A fundamentally different approach is needed — either triangle-connectivity-aware snapping, or a post-snap mesh smoothing pass. Reverted to hard snap baseline which remains the best overall result.

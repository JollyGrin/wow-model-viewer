# Ralph Progress Log

## [2026-02-18] Pre-Ralph: Texture Pipeline Setup
- Status: done
- Files changed: scripts/convert-model.ts, scripts/convert-textures.ts (new), src/loadModel.ts, src/main.ts, e2e/human-male.spec.ts (new), public/models/human-male.bin, public/models/textures/human-male-skin.tex (new), docs/LEARNINGS.md
- Notes: Added UV coordinates to model export (stride 24→32 bytes). Created BLP→raw RGBA converter. Applied skin texture using MeshLambertMaterial + DoubleSide. Fixed BLP color channel order (ABGR8888 is already RGBA in memory — no swizzle needed). Discovered model faces +X direction. Tested multiple skins — HumanMale_Magic.blp has best golden/warm tone. Known issues: waist "skirt" from geosets 1002/1102, no hair, sparse upper back geometry.

## [2026-02-18] Task: Fix the waist "skirt" with depth-based rendering
- Status: done
- Files changed: src/loadModel.ts, docs/LEARNINGS.md
- Notes: Replaced nearest-body-vertex lerp with height-binned centroid shrink + radius clamping. Clothing geosets (1002, 1102, 903) are now shrunk radially toward the body centroid at each Z-height (SHRINK=0.55), with a minimum radius floor (85% of body min radius) to prevent inner-thigh collapse. Tested 4 approaches: naive lerp, aggressive centroid shrink, selective protruding-vertex lerp, and clamped centroid shrink. The clamped approach gives the best result — waist band reads as tight shorts instead of a floating skirt. Remaining band visibility is due to lack of proper underwear texture compositing (requires base MPQ textures we don't have).

## [2026-02-18] Task: Try all available skin textures and pick the best one
- Status: done
- Files changed: docs/LEARNINGS.md
- Notes: Tested 4 BLP skins by converting each and comparing screenshots against reference. HumanMale_Magic.blp (already in use) is the best match — warm golden/peach tone closest to the reference's natural skin color. Pirate was too brown with tattoos, Skin00_101 too pale with purple underwear, Skin00_102 gray/marble. Skipped NecroBlue/WizardFel/WizardArcane (fantasy colors). The reference's golden shorts require base MPQ compositing we don't have. No code changes needed — kept existing skin.

## [2026-02-18] Task: Fix upper back/shoulder gaps
- Status: skipped
- Files changed: docs/LEARNINGS.md
- Notes: Investigated geosets 802 (24 tris) and 803 (72 tris) as candidates for filling the sparse upper back area (Z 1.00-1.25). Both geosets are mostly back-facing geometry but extend beyond the body silhouette (max |Y| = 0.619 vs body 0.535), creating visible sleeve flaps at the elbows. Tested 802+803 together and 802 alone — both created a clear visual regression with hanging sleeve geometry. The body mesh has sparse but present coverage (2-3 back-facing tris per height bin) — no actual see-through holes, just low-poly shading that looks flat compared to the reference's composited texture. The gap is a texture quality issue, not a missing geometry issue. Reverted to baseline. No code changes.

## [2026-02-18] Task: Add hair geoset
- Status: done
- Files changed: src/loadModel.ts, scripts/convert-textures.ts, docs/LEARNINGS.md, public/models/textures/human-male-hair.tex (new)
- Notes: Parsed M2 batch data to discover texture-to-submesh mappings (texLookup=0 skin, texLookup=1 hair, texLookup=2 cape). All hairstyle geosets (2-13) use hair texture. Enabled geoset 5 (hairstyle index 4 = long braids) instead of geoset 1 (bald cap). Converted Hair04_07.blp (dark brown, color variant 7) as hair texture. Created separate hair material (MeshLambertMaterial, DoubleSide) and hair mesh layer in the model loader. Front and back views now show long dark braided hair matching the reference's hairstyle. Both geometry and texture are applied correctly.

## [2026-02-18] Task: Improve lighting to match reference
- Status: done
- Files changed: src/main.ts, docs/LEARNINGS.md
- Notes: Reduced ambient light from 0.8→0.55 and increased front directional from 0.5→0.75 to deepen muscle shadow contrast. Added warm tints to all three lights (ambient 0xfff5e6, front 0xfff0dd, fill 0xffe8d0) to match the reference's golden skin tone. Result: abs, pecs, biceps, and shoulder blades now show clearly visible shadow definition. Warm tint brings skin color closer to reference. Background color (0x333333) already matches reference's dark charcoal — no change needed. Grid was already commented out (task 6 confirmed complete).

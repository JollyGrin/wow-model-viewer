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

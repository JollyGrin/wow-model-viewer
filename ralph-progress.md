# Ralph Progress Log

## [2026-02-18] Pre-Ralph: Texture Pipeline Setup
- Status: done
- Files changed: scripts/convert-model.ts, scripts/convert-textures.ts (new), src/loadModel.ts, src/main.ts, e2e/human-male.spec.ts (new), public/models/human-male.bin, public/models/textures/human-male-skin.tex (new), docs/LEARNINGS.md
- Notes: Added UV coordinates to model export (stride 24→32 bytes). Created BLP→raw RGBA converter. Applied skin texture using MeshLambertMaterial + DoubleSide. Fixed BLP color channel order (ABGR8888 is already RGBA in memory — no swizzle needed). Discovered model faces +X direction. Tested multiple skins — HumanMale_Magic.blp has best golden/warm tone. Known issues: waist "skirt" from geosets 1002/1102, no hair, sparse upper back geometry.

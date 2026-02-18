# Ralph Scope: Human Male Model Quality

## Goal
Get the textured human male model rendering to closely match the reference screenshots at `screenshots/REFERENCE/human-male-front.png` and `screenshots/REFERENCE/human-male-back.png`.

## How to Validate
After every change, run `/e2e-eval` which builds the project, runs Playwright tests, and takes screenshots. Then visually compare the test screenshots (`screenshots/human-male-front-test.png`, `screenshots/human-male-back-test.png`) against the reference PNGs using the Read tool. Describe what's better, what's worse, and what to try next.

## Current State
- Model renders with textured skin (HumanMale_Magic.blp — a custom Turtle WoW skin with golden tone)
- UV mapping works correctly
- MeshLambertMaterial + DoubleSide rendering
- Front/back camera views working via e2e test (`e2e/human-male.spec.ts`)
- Known issues: waist "skirt" from geosets 1002/1102, no hair, custom skin lacks face/underwear compositing

## Key Files
- `src/loadModel.ts` — Model loading, geoset filtering, material setup
- `src/main.ts` — Scene, camera, lighting
- `scripts/convert-textures.ts` — BLP→.tex converter (change `blpPath` to try different skins)
- `scripts/convert-model.ts` — M2→browser binary converter
- `e2e/human-male.spec.ts` — Playwright test that takes front+back screenshots
- `docs/LEARNINGS.md` — All findings so far (READ THIS FIRST)
- Available BLP skins: `data/patch/patch-3/Character/Human/Male/HumanMale_Magic.blp` (current), `HumanMale_Pirate.blp`, `HumanMaleSkin00_102.blp`, `data/patch/patch-8/Character/Human/Male/HumanMaleSkin00_101.blp` through `_105*.blp`

## Tasks

### 1. Fix the waist "skirt" with depth-based rendering
- **Description:** The geosets 1002 (undershirt) and 1102 (pants) create floating band geometry that looks like a skirt. Try rendering each geoset group as a separate `THREE.Mesh` within the group, so the body mesh naturally occludes the inside of the pants through Z-buffer ordering. Alternatively try `polygonOffset` on the body mesh to push it slightly forward, or try `depthWrite`/`depthTest` tricks on the inner geosets. The body (geoset 0) should visually sit in front of the underwear bands.
- **Acceptance:** Front view waist area looks like tight shorts or smooth skin, NOT a floating skirt. Compare to `screenshots/REFERENCE/human-male-front.png`.
- **Priority:** high

### 2. Try all available skin textures and pick the best one
- **Description:** Convert each available BLP skin and compare results. Edit `scripts/convert-textures.ts` to change the `blpPath`, run `npx tsx scripts/convert-textures.ts`, rebuild, and take screenshots. Available skins: `HumanMale_Magic.blp` (current golden), `HumanMale_Pirate.blp` (tanned/brown), `HumanMaleSkin00_101.blp` (warm flesh with purple underwear), `HumanMaleSkin00_102.blp` (gray/marble). Pick whichever best matches the reference's warm flesh tone with visible muscle detail.
- **Acceptance:** Skin color closely matches the reference's warm peach/brown flesh tone. Underwear region should not have wildly different color from skin.
- **Priority:** high

### 3. Fix upper back/shoulder gaps
- **Description:** The body mesh (geoset 0) has sparse geometry at Z 1.10-1.30 (upper back between shoulders). With DoubleSide this is mostly hidden, but triangles facing the wrong way still cause subtle gaps. Investigate whether adding geoset 802 or 803 (sleeves group 8) fills the gap without looking wrong. They cover Z=[0.96, 1.25]. If they add visible sleeves, skip them. Also check if the back-of-neck hole visible in back-view screenshots needs a specific geoset.
- **Acceptance:** Back view has no visible holes between shoulders or behind neck. Compare to `screenshots/REFERENCE/human-male-back.png`.
- **Priority:** medium

### 4. Add hair geoset
- **Description:** The reference has long dark hair (hairstyle ~5 or similar). Currently showing geoset 1 (bald cap). Try enabling one of the hairstyle geosets (2-13) instead of 1. Check which hairstyle number corresponds to the long braided hair in the reference. The hair texture (type 6 in the M2) would need a BLP, but even without the right texture, the geometry alone would be an improvement. Check `data/patch/patch-6/Character/Human/Hair04_*.blp` for hair textures.
- **Acceptance:** Character has visible hair geometry on the head. Bonus: hair has a texture applied.
- **Priority:** medium

### 5. Improve lighting to match reference
- **Description:** The reference uses a specific lighting setup — the character is well-lit from the front with soft shadows. Compare the current lighting (ambient 0.8, front directional 0.5, fill 0.3) to the reference and adjust. The reference appears to have slightly warm-toned lighting. Try adding a subtle warm tint to lights or adjusting intensities.
- **Acceptance:** Overall brightness and shadow depth matches the reference. Muscle definition is clearly visible.
- **Priority:** low

### 6. Remove grid and match background color
- **Description:** The reference has a dark charcoal/slate background (roughly #333-#444). The grid is currently commented out but the background color may not match. Check `renderer.setClearColor()` in `src/main.ts`.
- **Acceptance:** Background matches the reference's dark tone. No grid lines visible.
- **Priority:** low

## Constraints
- NEVER commit — only the human will commit manually
- NEVER read binary files (.m2, .blp, .skin) directly with the Read tool
- Use `npx tsx scripts/convert-textures.ts` to reconvert textures after changing the BLP source
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

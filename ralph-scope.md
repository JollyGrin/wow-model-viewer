# Ralph Scope: Polish Upper Legs

## Goal

Refine the upper leg/hip area to match the reference screenshot. The big issues (black gaps, waist skirt) are fixed. Three artifact issues remain from the vertex snapping approach.

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
- Waist skirt: FIXED (normal-based vertex snapping)
- Black gaps: FIXED (removed 55% shrink)
- Remaining issues (visible in legs close-up and front view):
  1. **Hip wing protrusions** — large triangular "wing" flaps at both hip sides where clothing meets body. Caused by vertex snapping distorting triangles — some vertices of a triangle snap to body position while adjacent ones don't, stretching the face outward. In the reference, these are tiny/minimal.
  2. **Dark crotch gap** — V-shaped dark area between the thighs. The vertex snapping may be too aggressive, snapping some clothing vertices that should be filling the crotch/inner-thigh body hole. In the reference, this area has continuous skin coverage.
  3. **Kneepad seams** — geoset 903 (kneepads) shows visible color/shading discontinuities at the knee boundary. In the reference, the transition is much smoother.

## Key Files

- `src/loadModel.ts` — Model loading, geoset filtering, material setup, vertex snapping logic
- `src/main.ts` — Scene, camera, lighting
- `e2e/human-male.spec.ts` — Playwright test with camera views
- `docs/LEARNINGS.md` — All findings so far

## Current Technique (in loadModel.ts)

For each clothing vertex:
1. Find nearest body vertex
2. Copy body vertex normal → clothing vertex (smooth shading)
3. Compute dot(displacement_from_body_to_clothing, body_normal)
4. If dot > 0.001 (outside body surface) → snap clothing position to body position
5. If dot <= 0.001 (inside body volume / filling hole) → leave position unchanged

Body renders with polygonOffset(-1,-1) to occlude clothing where both exist. Clothing renders without polygonOffset — only visible in body mesh holes.

## Tasks

### 1. Fix hip wing protrusions

- **Root Cause:** Hard vertex snapping creates stretched triangles when one vertex snaps but its neighbors don't. The snapped vertex jumps to the body surface while the non-snapped vertex stays in place, creating a long thin triangle that sticks out sideways.
- **Approach A — Smooth snapping:** Instead of hard snap (move 100% to body position), use a smooth falloff. Vertices with dot > threshold get pulled toward body proportionally: `lerp(clothing_pos, body_pos, clamp(dot / max_dot, 0, 1))`. This smooths the transition between snapped and unsnapped vertices, preventing triangle stretching.
- **Approach B — Propagation:** After the initial snap pass, do a smoothing pass: for each clothing vertex, average its position with its neighbors (connected via shared triangles). This spreads the snap effect and prevents isolated vertex jumps.
- **Approach C — Triangle-coherent snapping:** Only snap a vertex if ALL vertices of at least one of its triangles would also snap. This prevents the one-vertex-snapped-two-not distortion.
- **Acceptance:** Hip sides have no visible protruding wing flaps. Silhouette follows body contour smoothly.
- **Priority:** high

### 2. Fix dark crotch gap

- **Root Cause:** The vertex snapping with dot > 0.001 threshold may be too aggressive — snapping clothing vertices in the inner thigh area that should be filling the crotch hole. The body mesh has a large hole in the groin area that clothing geoset 1102 fills. If inner-thigh clothing vertices get snapped to the body boundary, they collapse and expose the hole.
- **Approach — Raise snapping threshold or limit by distance:** Only snap vertices that are both outside the body surface (dot > 0) AND close to a body vertex (distance < threshold). Vertices far from any body vertex are deep in the body hole and should never snap. Or try increasing the dot threshold to be less aggressive.
- **Acceptance:** Continuous skin coverage between the thighs matching the reference. No visible dark V-gap.
- **Priority:** high

### 3. Fix kneepad seams

- **Root Cause:** Geoset 903 (kneepads) has UVs that map to a different part of the skin texture than the adjacent body/lower-leg geosets. Even with normal copying, the UV-driven color difference creates visible seams at the boundary.
- **Approach A — UV copying:** In addition to copying normals, also copy UVs from the nearest body vertex. This makes kneepads sample the same texture region as the body, eliminating color discontinuity. Risk: may look wrong if the body UVs don't map well to the kneepad shape.
- **Approach B — Remove kneepads:** Simply disable geoset 903. The lower legs (501) and body (0) may cover the knee area adequately without kneepads. Check for new gaps.
- **Acceptance:** Smooth transition at the knee boundary, no visible color/shading band.
- **Priority:** medium

## Constraints

- NEVER commit — only the human will commit manually
- NEVER read binary files (.m2, .blp, .skin) directly with the Read tool
- Use `npm run build` to rebuild after code changes
- Record all findings in `docs/LEARNINGS.md`
- Keep changes minimal — one focused change per iteration

## Quality Bar

- tsc --noEmit passes
- npm run build succeeds
- e2e test passes (`npx playwright test e2e/human-male.spec.ts`)
- Screenshots compared to reference and improvement noted

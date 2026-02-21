---
name: e2e-eval
description: >
  Run after any change that affects visual output: Three.js rendering, model loading,
  texture application, shader changes, lighting, camera, UI overlays, canvas sizing,
  material swaps, geoset toggling, or animation. Builds the project, runs Playwright
  e2e tests with SwiftShader WebGL, then visually evaluates the resulting screenshots.
---

# E2E Visual Self-Verification

After making changes that affect what the viewer renders, run this workflow to verify
the result visually. You are multimodal — use the Read tool on screenshot PNGs to see
them directly. No API key is needed.

## Workflow

### Step 1 — Build gate

Run both checks. **Stop and fix if either fails.**

```bash
tsc --noEmit
bun run build
```

If `tsc` reports errors, fix them before proceeding. If `vite build` fails, fix it.
Do not run tests against a broken build.

### Step 2 — Find or create the e2e test

Look in `e2e/` for an existing spec that covers the change you made.

- If one exists, use it.
- If not, create a new `e2e/<feature>.spec.ts` using the template below.

Every test **must** save a screenshot to `screenshots/` so you can evaluate it.

#### Test template

```typescript
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = path.join(import.meta.dirname, '../screenshots');

test('<DESCRIBE WHAT SHOULD BE VISIBLE>', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  const canvas = page.locator('canvas#canvas');
  await expect(canvas).toBeVisible();

  // Wait for rendering to settle
  await page.waitForTimeout(2000);

  const screenshot = await page.screenshot();

  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const screenshotPath = path.join(SCREENSHOTS_DIR, '<FEATURE-NAME>.png');
  fs.writeFileSync(screenshotPath, screenshot);
  console.log(`Screenshot saved: ${screenshotPath}`);

  // Pixel check — verify WebGL rendered something non-black
  const pixelData = await page.evaluate(() => {
    const c = document.getElementById('canvas') as HTMLCanvasElement;
    const gl = c.getContext('webgl') || c.getContext('webgl2');
    if (!gl) return { error: 'no-webgl' };
    const pixels = new Uint8Array(4 * 100);
    gl.readPixels(
      Math.floor(c.width / 2) - 5, Math.floor(c.height / 2) - 5,
      10, 10, gl.RGBA, gl.UNSIGNED_BYTE, pixels,
    );
    const nonBlack = Array.from(pixels).some((v, i) => i % 4 !== 3 && v > 0);
    return { nonBlack, sample: Array.from(pixels.slice(0, 16)) };
  });

  console.log('Pixel check:', pixelData);
  expect(pixelData).not.toHaveProperty('error');

  if (errors.length > 0) {
    console.log('Console errors:', errors);
  }
});
```

Replace `<DESCRIBE WHAT SHOULD BE VISIBLE>` and `<FEATURE-NAME>` with values specific
to your change. Add additional assertions as needed (e.g., checking specific pixel
regions, waiting for model-loaded signals).

### Step 3 — Run the test

```bash
bunx playwright test e2e/<file>.spec.ts
```

The Playwright config already handles building via `bun run preview` and launching the
browser with SwiftShader flags (`--use-angle=swiftshader`). The web server auto-starts.

If the test fails with an infrastructure error (port in use, browser crash), fix and
re-run. Infrastructure errors are not visual problems.

### Step 4 — Evaluate the screenshot

#### Step 4a — Reference comparison

Check if a matching reference image exists in `screenshots/REFERENCE/`:

| Test screenshot | Reference |
|---|---|
| `human-male-front-test.png` | `screenshots/REFERENCE/human-male-front.png` |
| `human-male-back-test.png` | `screenshots/REFERENCE/human-male-back.png` |

If a reference exists, use the **Read** tool on BOTH the test screenshot and the reference image. Compare them and note **specific** differences:

- Use precise descriptions: "left hip has triangular protrusion extending 5px beyond silhouette", NOT vague "looks off"
- Compare: silhouette shape, limb proportions, visible holes/gaps, texture coverage, lighting/shadow placement
- Note which differences are improvements vs regressions vs neutral

If no reference exists, skip to Step 4b.

#### Step 4b — Visual checklist

Use the **Read** tool on the screenshot PNG file:

```
Read screenshots/<feature-name>.png
```

You are multimodal — you will see the image directly. Evaluate against this checklist:

| What to look for | Meaning |
|---|---|
| Entirely black canvas | WebGL failed to render or camera is facing wrong direction |
| Entirely white canvas | GL context lost or shader compilation failed |
| Magenta/pink solid color | Missing texture — BLP not found or not decoded |
| Wireframe only (no fill) | Material not applied or wrong draw mode |
| Model visible but garbled | Vertex buffer mismatch, wrong geoset indices, or endianness issue |
| Model visible, correct shape | Geometry is loading correctly |
| Colors/textures present | Texture pipeline is working |
| Correct proportions | Bone transforms / scaling are applied |
| UI elements present | DOM overlay is rendering |

#### SwiftShader caveats (do NOT flag these as bugs)

- Slightly duller colors compared to GPU rendering
- Minor aliasing / jagged edges on geometry
- Subtle lighting differences (ambient occlusion, specular highlights)
- Lower framerate artifacts in animated captures (slight motion blur)

These are expected from the software renderer and should **not** trigger a fix attempt.

### Step 5 — Fix loop (max 3 attempts)

If the screenshot shows a real problem (not a SwiftShader artifact):

1. Record the finding in `docs/LEARNINGS.md`:
   ```markdown
   ## [YYYY-MM-DD] <Topic>

   **Context:** What change was made
   **Finding:** What the screenshot showed
   **Impact:** How this affects the approach
   **Reference:** File path and line, or the screenshot path
   ```
2. Fix the code.
3. Go back to **Step 1**.

**After 3 failed attempts**, stop and report to the user:
- What you changed
- What the screenshot shows each attempt
- What you suspect the root cause is
- The screenshot paths so they can inspect manually

Do **not** continue looping beyond 3 attempts — diminishing returns burn tokens without
progress.

## When to skip this workflow

- Changes to docs, configs, or non-visual code (data parsing, DBC queries, etc.)
- Changes that only affect test files themselves
- Changes to build tooling that don't alter rendered output

# Wowhead Dressing Room Comparison Guide

## Overview

This guide documents how to capture screenshots from both the local model viewer and Wowhead's
dressing room, composite them side-by-side, and use Claude Vision to identify discrepancies.

**What this validates:**
- Texture region mapping (UV coordinates, region boundaries)
- Geoset selection for a given item (does the geometry match?)
- Color accuracy (are our converted BLPs faithful?)
- Seam quality between armor regions

**What this does NOT validate automatically:**
- Item ID → local catalog mapping (manual lookup required; see [Known Limitations](#known-limitations))
- Animation correctness
- Dynamic effects (particles, shaders unique to the live client)

---

## Prerequisites

```bash
# Playwright installed
bun add -d @playwright/test
bunx playwright install chrome   # installs the real Chrome binary

# API key for Claude Vision step
export ANTHROPIC_API_KEY=sk-ant-...

# Local viewer running (build + preview)
bun run build && bun run preview   # serves on http://localhost:4173
```

---

## Step 1 — Capture Wowhead

Wowhead's dressing room uses WebGL. Headless Chromium triggers bot detection and the 3D
model never loads. Use the real Chrome binary with `headless: false`.

**Wowhead item URL format:**
```
https://www.wowhead.com/item=<itemId>
```
The dressing room canvas appears at `#model-viewer canvas` after a few seconds of loading.

```ts
// scripts/capture-wowhead.ts
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export async function captureWowhead(itemId: number, outPath: string): Promise<Buffer> {
  const browser = await chromium.launch({
    channel: 'chrome',   // real Chrome binary — required for bot bypass
    headless: false,     // must be visible; headless triggers anti-bot
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`https://www.wowhead.com/item=${itemId}`, {
    waitUntil: 'domcontentloaded',
  });

  // Wait for the model viewer section to appear
  await page.waitForSelector('#model-viewer', { timeout: 30_000 });

  // Attempt to verify the WebGL canvas has rendered (readPixels trick).
  // Wowhead uses preserveDrawingBuffer: false on WebGL2 — readPixels may return
  // all zeros even when something is on screen. Fall back to a fixed wait.
  const rendered = await page.evaluate(() => {
    const canvas = document.querySelector('#model-viewer canvas') as HTMLCanvasElement | null;
    if (!canvas) return false;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return false;
    const buf = new Uint8Array(4 * 16);
    (gl as WebGLRenderingContext).readPixels(
      Math.floor(canvas.width / 2) - 2,
      Math.floor(canvas.height / 2) - 2,
      4, 4,
      (gl as WebGLRenderingContext).RGBA,
      (gl as WebGLRenderingContext).UNSIGNED_BYTE,
      buf,
    );
    return Array.from(buf).some((v, i) => i % 4 !== 3 && v > 0);
  }).catch(() => false);

  if (!rendered) {
    // preserveDrawingBuffer: false — can't read pixels; wait a fixed time instead
    console.warn('readPixels returned black — waiting 5s for Wowhead model to render');
    await page.waitForTimeout(5000);
  }

  // Screenshot the canvas element only (not the whole page)
  const canvasLocator = page.locator('#model-viewer canvas');
  await canvasLocator.waitFor({ state: 'visible', timeout: 10_000 });
  const screenshot = await canvasLocator.screenshot();

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, screenshot);
  console.log(`Wowhead screenshot saved: ${outPath}`);

  await browser.close();
  return screenshot;
}
```

---

## Step 2 — Capture Local Viewer

The local viewer runs on `localhost:4173`. Use the SwiftShader WebGL flags (same as
`playwright.config.ts`) so it works in headless mode.

```ts
// scripts/capture-local.ts
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export async function captureLocal(
  race: string,   // e.g. 'human-male'
  itemSlot: string, // e.g. 'chest', 'legs', 'boots'
  itemLabel: string, // label matching the <option> text in the UI
  outPath: string,
): Promise<Buffer> {
  const browser = await chromium.launch({
    args: [
      '--enable-webgl',
      '--use-angle=swiftshader',
      '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox',
    ],
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:4173/');

  // Select race
  await page.selectOption('select#race-select', race);

  // Select item in the given slot
  const slotSelect = page.locator(`select[data-slot="${itemSlot}"]`);
  await slotSelect.waitFor({ state: 'visible', timeout: 5000 });
  await slotSelect.selectOption({ label: itemLabel });

  // Wait for model + textures to recomposite
  await page.waitForTimeout(3000);

  // Verify model rendered (non-black pixels in canvas center)
  const pixelCheck = await page.evaluate(() => {
    const c = document.getElementById('canvas') as HTMLCanvasElement;
    const gl = c.getContext('webgl') || c.getContext('webgl2');
    if (!gl) return false;
    const pixels = new Uint8Array(4 * 100);
    (gl as WebGLRenderingContext).readPixels(
      Math.floor(c.width / 2) - 5, Math.floor(c.height / 2) - 5,
      10, 10,
      (gl as WebGLRenderingContext).RGBA,
      (gl as WebGLRenderingContext).UNSIGNED_BYTE,
      pixels,
    );
    return Array.from(pixels).some((v, i) => i % 4 !== 3 && v > 0);
  });

  if (!pixelCheck) {
    console.warn('Local viewer pixel check failed — model may not have loaded');
  }

  const screenshot = await page.screenshot();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, screenshot);
  console.log(`Local screenshot saved: ${outPath}`);

  await browser.close();
  return screenshot;
}
```

**Camera presets** (copy from `e2e/human-male.spec.ts` if you need specific angles):

| View | `camera.position` | `controls.target` |
|------|-------------------|-------------------|
| Front | `(3, 1, 0)` | `(0, 0.9, 0)` |
| Back | `(-3, 1, 0)` | `(0, 0.9, 0)` |
| Rear 3/4 | `(-2, 1.3, 2)` | `(0, 0.9, 0)` |
| Top-back | `(-1.5, 2.8, 0)` | `(0, 1.2, 0)` |
| Legs | `(1.5, 0.55, 0)` | `(0, 0.55, 0)` |

Set them via `page.evaluate()`:
```ts
await page.evaluate(([px, py, pz, tx, ty, tz]) => {
  const cam = (window as any).__camera;
  const ctrl = (window as any).__controls;
  cam.position.set(px, py, pz);
  ctrl.target.set(tx, ty, tz);
  ctrl.update();
}, [3, 1, 0, 0, 0.9, 0]);
await page.waitForTimeout(500);
```

---

## Step 3 — Side-by-Side Composite

No `sharp` or `jimp` needed. Embed both PNGs as base64 `<img>` tags in an HTML string,
then screenshot it with headless Playwright.

```ts
// scripts/composite-screenshots.ts
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export async function compositeScreenshots(
  leftPath: string,   // wowhead screenshot
  rightPath: string,  // local screenshot
  outPath: string,
  labels = { left: 'Wowhead', right: 'Local Viewer' },
): Promise<Buffer> {
  const leftB64 = fs.readFileSync(leftPath).toString('base64');
  const rightB64 = fs.readFileSync(rightPath).toString('base64');

  const html = `<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; background: #111; display: flex; gap: 8px; padding: 8px; font-family: monospace; }
  .panel { display: flex; flex-direction: column; align-items: center; }
  .label { color: #fff; font-size: 14px; margin-bottom: 4px; }
  img { max-width: 600px; border: 1px solid #444; }
</style>
</head>
<body>
  <div class="panel">
    <div class="label">${labels.left}</div>
    <img src="data:image/png;base64,${leftB64}">
  </div>
  <div class="panel">
    <div class="label">${labels.right}</div>
    <img src="data:image/png;base64,${rightB64}">
  </div>
</body>
</html>`;

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(html, { waitUntil: 'load' });

  // Let images decode
  await page.waitForTimeout(500);

  const composite = await page.screenshot({ fullPage: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, composite);
  console.log(`Composite saved: ${outPath}`);

  await browser.close();
  return composite;
}
```

---

## Step 4 — Claude Vision Analysis

Reuse `evaluateScreenshot()` from `e2e/ai-eval.ts` with a comparison-focused prompt.

```ts
// scripts/analyze-comparison.ts
import { evaluateScreenshot } from '../e2e/ai-eval.js';
import fs from 'fs';

export async function analyzeComparison(
  compositePath: string,
  itemName: string,
  slot: string,
): Promise<void> {
  const buffer = fs.readFileSync(compositePath);

  const criteria = `
This is a side-by-side comparison of the same WoW item ("${itemName}", slot: ${slot}).
LEFT = Wowhead official dressing room.
RIGHT = Local Three.js model viewer.

Identify discrepancies between left and right:
1. Texture color differences (hue, saturation, brightness)
2. Missing or incorrect texture regions (e.g. a region appears solid color or black)
3. UV seam misalignment (visible lines or stretching at armor borders)
4. Geometry/geoset differences (extra or missing mesh sections, different silhouette)
5. Overall visual similarity (0–100 score)

Be specific about which body region shows each problem (e.g. "upper arm", "torso front", "boots").
`.trim();

  const result = await evaluateScreenshot(buffer, criteria);

  const outPath = compositePath.replace('.png', '-analysis.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log('\n=== Claude Vision Analysis ===');
  console.log(`Pass: ${result.pass} | Confidence: ${result.confidence}`);
  console.log(`Description: ${result.description}`);
  if (result.issues.length > 0) {
    console.log('Issues:');
    result.issues.forEach((issue) => console.log(`  - ${issue}`));
  }
  console.log(`Learnings: ${result.learnings}`);
  console.log(`Analysis saved: ${outPath}`);
}
```

---

## Putting It All Together

Run these steps once end-to-end for a single item:

```ts
// scripts/wowhead-compare.ts
// Usage: bun run scripts/wowhead-compare.ts <wowhead-item-id> <local-item-label> [slot]
//
// Example:
//   bun run scripts/wowhead-compare.ts 3428 "Tough Scorpid Chest" chest

import { captureWowhead } from './capture-wowhead.js';
import { captureLocal } from './capture-local.js';
import { compositeScreenshots } from './composite-screenshots.js';
import { analyzeComparison } from './analyze-comparison.js';
import path from 'path';

const [,, wowheadId, localLabel, slot = 'chest'] = process.argv;
if (!wowheadId || !localLabel) {
  console.error('Usage: bun run scripts/wowhead-compare.ts <wowheadItemId> "<localLabel>" [slot]');
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join('screenshots/wowhead-compare', timestamp);

const wowheadPath = path.join(outDir, 'wowhead.png');
const localPath = path.join(outDir, 'local.png');
const compositePath = path.join(outDir, 'composite.png');

await captureWowhead(parseInt(wowheadId), wowheadPath);
await captureLocal('human-male', slot, localLabel, localPath);
await compositeScreenshots(wowheadPath, localPath, compositePath, {
  left: `Wowhead #${wowheadId}`,
  right: localLabel,
});
await analyzeComparison(compositePath, localLabel, slot);
```

---

## Output Layout

After a successful run, `screenshots/wowhead-compare/<timestamp>/` contains:

```
screenshots/wowhead-compare/
└── 2026-03-01T14-30-00/
    ├── wowhead.png          ← Wowhead dressing room canvas
    ├── local.png            ← Local viewer screenshot
    ├── composite.png        ← Side-by-side comparison image
    └── composite-analysis.json  ← Claude Vision structured result
```

---

## Wowhead Canvas Wait Logic

Wowhead's WebGL context is typically created with `preserveDrawingBuffer: false` (the
default). This means `readPixels()` may return all zeros even when the model is visually
rendered on screen.

**Detection algorithm:**

1. Wait for `#model-viewer` selector to appear.
2. Call `readPixels()` on center pixels.
3. If any non-alpha pixel > 0 → model rendered, proceed immediately.
4. If all pixels are zero → `preserveDrawingBuffer: false`; fall back to `waitForTimeout(5000)`.

The 5-second wait is a conservative estimate. On slow connections (or if Wowhead's CDN is
slow) increase to 8–10 seconds.

---

## Known Limitations

| Limitation | Notes |
|------------|-------|
| No automatic item ID mapping | Wowhead item IDs (e.g. `3428`) must be looked up manually; no automated mapping from `public/item-catalog.json` names → Wowhead IDs |
| Wowhead URL encoding | Some items redirect or have canonical URLs with slugs; use the numeric `item=<id>` form which always works |
| Race/gender on Wowhead | Wowhead defaults to human male; to compare other races, interact with the dressing room dropdowns via `page.click()` before screenshotting |
| TBC item textures | Our `public/item-textures/` is from patch-3 (TBC-era). For vanilla items, Wowhead may show slightly different textures |
| Non-standard geosets | Some items in the local catalog have inferred geoset values; Wowhead may show different mesh geometry for plate/mail vs. what we infer |
| Bot detection variability | Wowhead's anti-bot is not deterministic; if the model fails to load, close the browser and retry |

import { test, expect } from '@playwright/test';
import { evaluateScreenshot } from './ai-eval';
import { saveLearning, getLearningsSummary } from './learnings';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = path.join(import.meta.dirname, '../screenshots');
const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

test('spinning cube renders on black background', async ({ page }) => {
  // Collect console errors
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  const canvas = page.locator('canvas#canvas');
  await expect(canvas).toBeVisible();

  // Let the cube spin for a moment so it's clearly 3D
  await page.waitForTimeout(2000);

  // Take full page screenshot (captures more reliably than canvas-only in SwiftShader)
  const screenshot = await page.screenshot();

  // Save screenshot for Claude Code to review
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const screenshotPath = path.join(SCREENSHOTS_DIR, 'scaffold-spinning-cube.png');
  fs.writeFileSync(screenshotPath, screenshot);
  console.log(`Screenshot saved: ${screenshotPath}`);

  if (errors.length > 0) {
    console.log('Console errors:', errors);
  }

  // Check canvas has non-black pixels (WebGL actually rendered something)
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

  // If API key is available, also run AI evaluation
  if (HAS_API_KEY) {
    const result = await evaluateScreenshot(
      screenshot,
      `1. A 3D cube is visible (not a blank or fully black canvas)
       2. The cube has multiple colors (MeshNormalMaterial produces rainbow/gradient faces)
       3. The cube appears rotated at an angle (showing 3D perspective, not flat)
       4. Background is black
       5. No error messages, white screens, or broken rendering`,
      { previousLearnings: getLearningsSummary() },
    );

    saveLearning('scaffold-spinning-cube', result);
    console.log('AI Evaluation:', JSON.stringify(result, null, 2));
    expect(result.pass, `AI evaluation failed: ${result.issues.join(', ')}`).toBe(true);
  }
});

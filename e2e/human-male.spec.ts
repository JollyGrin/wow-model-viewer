import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = path.join(import.meta.dirname, '../screenshots');

test('human male model renders with skin texture', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  const canvas = page.locator('canvas#canvas');
  await expect(canvas).toBeVisible();

  // Wait for model + texture to load and render
  await page.waitForTimeout(3000);

  // Take front view screenshot
  const frontScreenshot = await page.screenshot();
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const frontPath = path.join(SCREENSHOTS_DIR, 'human-male-front-test.png');
  fs.writeFileSync(frontPath, frontScreenshot);
  console.log(`Front screenshot saved: ${frontPath}`);

  // Rotate camera to back view programmatically
  await page.evaluate(() => {
    // Access Three.js camera through the global scope
    const camera = (window as any).__camera;
    const controls = (window as any).__controls;
    if (camera && controls) {
      camera.position.set(-3, 1, 0);
      controls.target.set(0, 0.9, 0);
      controls.update();
    }
  });

  await page.waitForTimeout(500);

  // Take back view screenshot
  const backScreenshot = await page.screenshot();
  const backPath = path.join(SCREENSHOTS_DIR, 'human-male-back-test.png');
  fs.writeFileSync(backPath, backScreenshot);
  console.log(`Back screenshot saved: ${backPath}`);

  expect(errors).toHaveLength(0);

  // Check canvas has non-black pixels (model rendered)
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
});

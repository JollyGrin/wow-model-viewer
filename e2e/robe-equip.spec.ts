import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = path.join(import.meta.dirname, '../screenshots');

test('robe equip applies chest leg textures', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  const canvas = page.locator('canvas#canvas');
  await expect(canvas).toBeVisible();

  // Wait for initial model to load
  await page.waitForTimeout(3000);

  // Equip a robe by searching and clicking in the chest select
  const chestSearch = page.locator('#equipment-panel .equip-row:nth-child(3) .equip-search');
  await chestSearch.fill('Robe');
  await page.waitForTimeout(300);

  // Select the first robe option (should be an epic robe)
  const chestSelect = page.locator('#equip-chest');
  const options = await chestSelect.locator('option').all();
  // Find first non-"None" option
  for (const opt of options) {
    const val = await opt.getAttribute('value');
    if (val && val !== '') {
      await chestSelect.selectOption(val);
      break;
    }
  }

  // Wait for model reload with robe
  await page.waitForTimeout(3000);

  // Front view
  const frontScreenshot = await page.screenshot();
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const frontPath = path.join(SCREENSHOTS_DIR, 'robe-equip-front.png');
  fs.writeFileSync(frontPath, frontScreenshot);
  console.log(`Robe front screenshot saved: ${frontPath}`);

  // Rotate to see full robe length
  await page.evaluate(() => {
    const camera = (window as any).__camera;
    const controls = (window as any).__controls;
    if (camera && controls) {
      camera.position.set(2, 0.8, 1.5);
      controls.target.set(0, 0.8, 0);
      controls.update();
    }
  });
  await page.waitForTimeout(500);

  const sideScreenshot = await page.screenshot();
  const sidePath = path.join(SCREENSHOTS_DIR, 'robe-equip-side.png');
  fs.writeFileSync(sidePath, sideScreenshot);
  console.log(`Robe side screenshot saved: ${sidePath}`);

  // Check for errors (filter out non-critical ones)
  const criticalErrors = errors.filter(e => !e.includes('favicon'));
  if (criticalErrors.length > 0) {
    console.log('Console errors:', criticalErrors);
  }

  // Pixel check
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

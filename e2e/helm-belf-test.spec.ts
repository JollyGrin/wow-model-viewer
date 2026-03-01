import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = path.join(import.meta.dirname, '../screenshots');

test('blood elf alabaster plate - hair hiding', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'warning' || t === 'error' || t === 'log') logs.push(`[${t}] ${msg.text()}`);
  });

  await page.goto('/');
  await expect(page.locator('canvas#canvas')).toBeVisible();
  await page.waitForTimeout(2000);
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  // Switch to blood elf male
  await page.evaluate(() => {
    const raceSel = document.getElementById('race-select') as HTMLSelectElement;
    const genSel = document.getElementById('gender-select') as HTMLSelectElement;
    raceSel.value = 'blood-elf'; raceSel.dispatchEvent(new Event('change'));
    genSel.value = 'male'; genSel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(3000);

  // No helmet - see hair
  const targetY = await page.evaluate(() => (window as any).__controls.target.y as number);
  const headY = targetY + targetY * 0.85;
  await page.evaluate(({ hY }: { hY: number }) => {
    const camera = (window as any).__camera;
    const controls = (window as any).__controls;
    camera.position.set(0.7, hY, 0.4);
    controls.target.set(0, hY - 0.05, 0);
    controls.update();
  }, { hY: headY });
  await page.waitForTimeout(500);
  fs.writeFileSync(path.join(SCREENSHOTS_DIR, 'belf-nohelm.png'), await page.screenshot());

  // Equip Alabaster Plate Helmet
  const found = await page.evaluate(() => {
    const sel = document.getElementById('equip-head') as HTMLSelectElement;
    if (!sel) return null;
    const opts = Array.from(sel.options);
    const match = opts.find(o => o.textContent?.toLowerCase().includes('alabaster'));
    if (!match) return null;
    sel.value = match.value;
    sel.dispatchEvent(new Event('change'));
    return match.textContent;
  });
  console.log('Found:', found);
  await page.waitForTimeout(3000);

  // Reposition camera
  const targetY2 = await page.evaluate(() => (window as any).__controls.target.y as number);
  const headY2 = targetY2 + targetY2 * 0.85;
  await page.evaluate(({ hY }: { hY: number }) => {
    const camera = (window as any).__camera;
    const controls = (window as any).__controls;
    camera.position.set(0.7, hY, 0.4);
    controls.target.set(0, hY - 0.05, 0);
    controls.update();
  }, { hY: headY2 });
  await page.waitForTimeout(500);
  fs.writeFileSync(path.join(SCREENSHOTS_DIR, 'belf-alabaster.png'), await page.screenshot());

  // Print all relevant logs
  for (const l of logs) console.log(l);
});

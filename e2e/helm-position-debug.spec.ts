import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = path.join(import.meta.dirname, '../screenshots');

test('helmet position debug', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto('/');
  await expect(page.locator('canvas#canvas')).toBeVisible();
  await page.waitForTimeout(2000);
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  // Equip the gilneas hat
  const found = await page.evaluate(() => {
    const sel = document.getElementById('equip-head') as HTMLSelectElement;
    if (!sel) return 'no select';
    const opts = Array.from(sel.options);
    const match = opts.find(o => o.textContent?.toLowerCase().includes('gilneas'));
    if (!match) return 'no gilneas option';
    sel.value = match.value;
    sel.dispatchEvent(new Event('change'));
    return match.textContent;
  });
  console.log('Selected helmet:', found);
  await page.waitForTimeout(4000);

  // Print debug logs
  const helmLogs = logs.filter(l => l.includes('HELM DEBUG'));
  console.log(`Found ${helmLogs.length} HELM DEBUG logs out of ${logs.length} total`);
  for (const l of helmLogs) console.log(l);

  // Print all logs if no HELM logs
  if (helmLogs.length === 0) {
    for (const l of logs) {
      console.log(l);
    }
  }

  // Take side view screenshot
  const targetY = await page.evaluate(() => (window as any).__controls.target.y as number);
  const headY = targetY + targetY * 0.85;
  await page.evaluate(({ hY }: { hY: number }) => {
    const camera = (window as any).__camera;
    const controls = (window as any).__controls;
    camera.position.set(1.2, hY, 0.0);
    controls.target.set(0, hY - 0.05, 0);
    controls.update();
  }, { hY: headY });
  await page.waitForTimeout(500);
  fs.writeFileSync(path.join(SCREENSHOTS_DIR, 'helm-pos-debug-side.png'), await page.screenshot());
});

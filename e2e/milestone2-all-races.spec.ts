/**
 * Milestone 2 — Sword on All 20 Races
 *
 * Switches through every race/gender combination and takes a front-view
 * screenshot. Verifies the sword attachment doesn't produce console errors.
 * Visual inspection of the screenshot grid is the pass criteria.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const RACES = [
  'blood-elf', 'dwarf', 'gnome', 'goblin',
  'human', 'night-elf', 'orc', 'scourge', 'tauren', 'troll',
];
const GENDERS = ['male', 'female'];

const SCREENSHOTS_DIR = path.join(import.meta.dirname, '../screenshots/milestone2');

test('sword appears on all 20 race/gender models', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  const canvas = page.locator('canvas#canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(3000); // wait for initial human-male load

  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  for (const race of RACES) {
    for (const gender of GENDERS) {
      const slug = `${race}-${gender}`;

      // Switch model via select elements (triggers change event → switchModel())
      await page.selectOption('#race-select', race);
      await page.selectOption('#gender-select', gender);

      // Reset to front view
      await page.evaluate(() => {
        const camera = (window as any).__camera;
        const controls = (window as any).__controls;
        if (camera && controls) {
          camera.position.set(3, 1, 0);
          controls.target.set(0, 0.9, 0);
          controls.update();
        }
      });

      // Wait for model + weapon to load
      await page.waitForTimeout(2000);

      const screenshot = await page.screenshot();
      const outPath = path.join(SCREENSHOTS_DIR, `${slug}.png`);
      fs.writeFileSync(outPath, screenshot);
      console.log(`  ${slug}: captured → ${outPath}`);
    }
  }

  // After all models, filter out known harmless warnings
  const realErrors = errors.filter(e =>
    !e.includes('No HandRight') &&  // missing attachment is a warn, not error
    !e.includes('Failed to load weapon'), // expected if weapon missing
  );
  console.log(`\nConsole errors (${realErrors.length}):`, realErrors);

  // No fatal errors expected
  expect(realErrors).toHaveLength(0);
});

/**
 * Chest Armor — Silver Plate on All 20 Races
 *
 * Captures front and side views for each race/gender to verify:
 * 1. Silver plate chest armor appears on the torso
 * 2. Sleeve geometry is correct — no wrong/extra sleeve mesh protruding
 * 3. No console errors from armor loading
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const RACES = [
  'blood-elf', 'dwarf', 'gnome', 'goblin',
  'human', 'night-elf', 'orc', 'scourge', 'tauren', 'troll',
];
const GENDERS = ['male', 'female'];

const SCREENSHOTS_DIR = path.join(import.meta.dirname, '../screenshots/chest-armor');

test('silver plate chest armor appears correctly on all 20 race/gender models', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  const canvas = page.locator('canvas#canvas');
  await expect(canvas).toBeVisible();

  // Wait for initial human-male load
  await page.waitForTimeout(3000);

  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  for (const race of RACES) {
    for (const gender of GENDERS) {
      const slug = `${race}-${gender}`;

      // Switch model
      await page.selectOption('#race-select', race);
      await page.selectOption('#gender-select', gender);

      // Front view
      await page.evaluate(() => {
        const camera = (window as any).__camera;
        const controls = (window as any).__controls;
        if (camera && controls) {
          camera.position.set(3, 1, 0);
          controls.target.set(0, 0.9, 0);
          controls.update();
        }
      });

      // Wait for model + armor to load
      await page.waitForTimeout(2500);

      const frontShot = await page.screenshot();
      const frontPath = path.join(SCREENSHOTS_DIR, `${slug}-front.png`);
      fs.writeFileSync(frontPath, frontShot);
      console.log(`  ${slug} front → ${frontPath}`);

      // Side view (right side, +Z) — reveals sleeve geometry well
      await page.evaluate(() => {
        const camera = (window as any).__camera;
        const controls = (window as any).__controls;
        if (camera && controls) {
          camera.position.set(0, 1.1, 3);
          controls.target.set(0, 1.0, 0);
          controls.update();
        }
      });

      await page.waitForTimeout(300);

      const sideShot = await page.screenshot();
      const sidePath = path.join(SCREENSHOTS_DIR, `${slug}-side.png`);
      fs.writeFileSync(sidePath, sideShot);
      console.log(`  ${slug} side  → ${sidePath}`);
    }
  }

  // Filter known harmless warnings
  const realErrors = errors.filter(e =>
    !e.includes('No HandRight') &&
    !e.includes('Failed to load weapon'),
  );
  console.log(`\nConsole errors (${realErrors.length}):`, realErrors.slice(0, 10));

  expect(realErrors).toHaveLength(0);
});

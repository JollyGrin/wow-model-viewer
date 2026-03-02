import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = path.join(import.meta.dirname, '../screenshots');

async function switchRaceGender(page: any, race: string, gender: string) {
  await page.evaluate(({ r, g }: { r: string; g: string }) => {
    const raceSel = document.getElementById('race-select') as HTMLSelectElement;
    const genSel = document.getElementById('gender-select') as HTMLSelectElement;
    if (raceSel) { raceSel.value = r; raceSel.dispatchEvent(new Event('change')); }
    if (genSel) { genSel.value = g; genSel.dispatchEvent(new Event('change')); }
  }, { r: race, g: gender });
  await page.waitForTimeout(2000);
}

async function selectHelmet(page: any, nameFragment: string): Promise<string | null> {
  return page.evaluate((name: string) => {
    const sel = document.getElementById('equip-head') as HTMLSelectElement;
    if (!sel) return null;
    const opts = Array.from(sel.options);
    const match = opts.find(o => o.textContent?.toLowerCase().includes(name.toLowerCase()));
    if (!match) return null;
    sel.value = match.value;
    sel.dispatchEvent(new Event('change'));
    return match.textContent;
  }, nameFragment);
}

async function positionCameraOnHead(page: any) {
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
}

test('helmet rendering - head close-up (human male)', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'warning' || t === 'error' || t === 'log') logs.push(`[${t}] ${msg.text()}`);
  });

  await page.goto('/');
  await expect(page.locator('canvas#canvas')).toBeVisible();
  await page.waitForTimeout(2000);
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  async function testHelmet(nameFragment: string, filename: string) {
    const found = await selectHelmet(page, nameFragment);
    if (!found) { console.log(`Skip: ${nameFragment}`); return; }
    console.log(`Testing: ${found}`);
    await page.waitForTimeout(3000);
    await positionCameraOnHead(page);

    fs.writeFileSync(
      path.join(SCREENSHOTS_DIR, `helm-${filename}-front.png`),
      await page.screenshot(),
    );
  }

  await testHelmet('crusader', 'crusader');
  await testHelmet('Judgement', 'judgement');
  await testHelmet('dk-b', 'dkb');
  await testHelmet('dungeonpaladin', 'dungpal');
  await testHelmet('custom-warry', 'warry');
  await testHelmet('zulaman-d-01', 'zulaman');

  const filtered = logs.filter(l => !l.includes('WebGL') && !l.includes('GPU stall') && !l.includes('[log]'));
  if (filtered.length) console.log('Console:', filtered);
});

test('helmet rendering - cross race/gender', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'warning' || t === 'error' || t === 'log') logs.push(`[${t}] ${msg.text()}`);
  });

  await page.goto('/');
  await expect(page.locator('canvas#canvas')).toBeVisible();
  await page.waitForTimeout(2000);
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const races = [
    { race: 'orc', gender: 'male' },
    { race: 'night-elf', gender: 'female' },
    { race: 'tauren', gender: 'male' },
    { race: 'gnome', gender: 'female' },
    { race: 'blood-elf', gender: 'male' },
    { race: 'dwarf', gender: 'male' },
    { race: 'troll', gender: 'male' },
    { race: 'scourge', gender: 'male' },
  ];

  for (const { race, gender } of races) {
    const tag = `${race}-${gender}`;
    console.log(`\nSwitching to ${tag}...`);
    await switchRaceGender(page, race, gender);

    // Try to equip a helmet that's likely available for this race
    const found = await selectHelmet(page, 'plate');
    if (!found) {
      console.log(`  No plate helmet for ${tag}, trying dk-b...`);
      const alt = await selectHelmet(page, 'dk');
      if (!alt) { console.log(`  Skip ${tag}: no helmet available`); continue; }
      console.log(`  Using: ${alt}`);
    } else {
      console.log(`  Using: ${found}`);
    }

    await page.waitForTimeout(3000);
    await positionCameraOnHead(page);

    fs.writeFileSync(
      path.join(SCREENSHOTS_DIR, `helm-race-${tag}.png`),
      await page.screenshot(),
    );
  }

  const filtered = logs.filter(l => !l.includes('WebGL') && !l.includes('GPU stall') && !l.includes('[log]'));
  if (filtered.length) console.log('Console:', filtered);
});

#!/usr/bin/env bun
/**
 * Build all assets from extracted game data → web-ready format.
 *
 * Run this after setup-from-client.ts has populated data/.
 * Executes the full pipeline in the correct order:
 *
 *   1. extract-mpq-items.ts         - M2+BLP from MPQs -> public/items/
 *   2. extract-mpq-textures.ts      - BLP from MPQs -> public/item-textures/
 *   3. extract-char-attachments.ts  - Attachment points from M2s -> data/char-attachments.json
 *   4. convert-model.ts             - Character M2s -> public/models/ (20 races)
 *   5. convert-textures.ts          - Character BLPs -> skin + hair textures
 *   6. convert-item-textures.ts     - Patch BLPs -> public/item-textures/
 *   7. convert-item.ts              - Patch M2+BLP -> public/items/weapon/
 *   8. convert-head-item.ts         - Helmet M2+BLP -> public/items/head/
 *   9. convert-shoulder-item.ts     - Shoulder M2+BLP -> public/items/shoulder/
 *  10. build-item-catalog.ts        - Index all items -> public/item-catalog.json
 *
 * Usage:
 *   bun run scripts/build-assets.ts
 *
 * After this completes, run: bun run dev
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { $ } from 'bun';

const ROOT = resolve(import.meta.dirname, '..');

// ── Preflight checks ───────────────────────────────────────────────────────

const requiredFiles = [
  { path: 'data/model/model.MPQ', label: 'model.MPQ' },
  { path: 'data/model/texture.MPQ', label: 'texture.MPQ' },
  { path: 'data/model/patch.MPQ', label: 'patch.MPQ' },
  { path: 'data/dbc/ItemDisplayInfo.json', label: 'ItemDisplayInfo.json' },
  { path: 'data/dbc/CharSections.json', label: 'CharSections.json' },
];

const missing = requiredFiles.filter(f => !existsSync(resolve(ROOT, f.path)));
if (missing.length > 0) {
  console.error('Missing required files:');
  for (const f of missing) console.error(`  ${f.label} — expected at ${f.path}`);
  console.error('\nRun setup-from-client.ts first:');
  console.error('  bun run scripts/setup-from-client.ts /path/to/TurtleWoW');
  process.exit(1);
}

// ── Pipeline steps ──────────────────────────────────────────────────────────

interface Step {
  name: string;
  script: string;
  needsMpq: boolean; // steps that read MPQ archives
}

const STEPS: Step[] = [
  { name: 'Extract item models from MPQs',     script: 'scripts/extract-mpq-items.ts',          needsMpq: true },
  { name: 'Extract item textures from MPQs',   script: 'scripts/extract-mpq-textures.ts',       needsMpq: true },
  { name: 'Extract character attachments',      script: 'scripts/extract-char-attachments.ts',   needsMpq: true },
  { name: 'Convert character models',           script: 'scripts/convert-model.ts',              needsMpq: false },
  { name: 'Convert character textures',         script: 'scripts/convert-textures.ts',           needsMpq: false },
  { name: 'Convert patch item textures',        script: 'scripts/convert-item-textures.ts',      needsMpq: false },
  { name: 'Convert patch weapon models',        script: 'scripts/convert-item.ts',               needsMpq: false },
  { name: 'Convert helmet models',              script: 'scripts/convert-head-item.ts',          needsMpq: false },
  { name: 'Convert shoulder models',            script: 'scripts/convert-shoulder-item.ts',      needsMpq: false },
  { name: 'Build item catalog',                 script: 'scripts/build-item-catalog.ts',         needsMpq: false },
];

console.log('=== Asset Build Pipeline ===\n');

const startTotal = Date.now();

for (let i = 0; i < STEPS.length; i++) {
  const step = STEPS[i];
  const scriptPath = resolve(ROOT, step.script);

  if (!existsSync(scriptPath)) {
    console.error(`\n[${i + 1}/${STEPS.length}] SKIP — script not found: ${step.script}`);
    continue;
  }

  console.log(`\n[${ i + 1}/${STEPS.length}] ${step.name}`);
  console.log(`    ${step.script}`);
  console.log('─'.repeat(60));

  const start = Date.now();

  try {
    const result = await $`bun run ${scriptPath}`.cwd(ROOT).quiet();
    const output = result.stdout.toString();

    // Print just the summary lines (last few lines usually have stats)
    const lines = output.trim().split('\n');
    const summaryStart = lines.findIndex(l => /^===|^Summary|^Total|^Models|^Textures|^Written|^Converted|^Converting/.test(l.trim()));
    const summaryLines = summaryStart >= 0 ? lines.slice(summaryStart) : lines.slice(-10);
    for (const line of summaryLines) {
      console.log(`    ${line}`);
    }
  } catch (err: any) {
    // Bun shell throws on non-zero exit
    const output = err.stdout?.toString?.() || '';
    const stderr = err.stderr?.toString?.() || '';
    const lines = (output + stderr).trim().split('\n');
    for (const line of lines.slice(-15)) {
      console.log(`    ${line}`);
    }
    console.error(`    FAILED (exit ${err.exitCode})`);
    // Continue — some steps may fail partially (TBC-era items) and that's OK
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`    (${elapsed}s)`);
}

const totalElapsed = ((Date.now() - startTotal) / 1000).toFixed(1);

console.log('\n' + '='.repeat(60));
console.log(`Asset build complete in ${totalElapsed}s\n`);
console.log('Start the viewer:');
console.log('  bun run dev');

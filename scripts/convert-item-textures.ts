/**
 * Convert item armor BLP textures to .tex files for browser consumption.
 *
 * Reads BLPs from data/patch/patch-3/Item/TextureComponents/{Region}/
 * and writes .tex files to public/item-textures/{Region}/
 *
 * .tex format: uint16 width + uint16 height + raw RGBA pixels (same as skin.tex)
 *
 * Usage: bun run scripts/convert-item-textures.ts
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { resolve, basename, extname } from 'path';

const { Blp, BLP_IMAGE_FORMAT } = await import('@wowserhq/format');

const ROOT = resolve(import.meta.dirname, '..');

const REGIONS = [
  { blpDir: 'data/patch/patch-3/Item/TextureComponents/ArmUpperTexture',  outDir: 'public/item-textures/ArmUpperTexture' },
  { blpDir: 'data/patch/patch-3/Item/TextureComponents/ArmLowerTexture',  outDir: 'public/item-textures/ArmLowerTexture' },
  { blpDir: 'data/patch/patch-3/Item/TextureComponents/HandTexture',       outDir: 'public/item-textures/HandTexture' },
  { blpDir: 'data/patch/patch-3/Item/TextureComponents/TorsoUpperTexture', outDir: 'public/item-textures/TorsoUpperTexture' },
  { blpDir: 'data/patch/patch-3/Item/TextureComponents/TorsoLowerTexture', outDir: 'public/item-textures/TorsoLowerTexture' },
  { blpDir: 'data/patch/patch-3/Item/TextureComponents/LegUpperTexture',   outDir: 'public/item-textures/LegUpperTexture' },
  { blpDir: 'data/patch/patch-3/Item/TextureComponents/LegLowerTexture',   outDir: 'public/item-textures/LegLowerTexture' },
  { blpDir: 'data/patch/patch-3/Item/TextureComponents/FootTexture',       outDir: 'public/item-textures/FootTexture' },
];

function writeTexFile(outPath: string, width: number, height: number, rgba: Uint8Array): number {
  const header = new Uint8Array(4);
  const headerView = new DataView(header.buffer);
  headerView.setUint16(0, width, true);
  headerView.setUint16(2, height, true);
  const output = new Uint8Array(4 + rgba.byteLength);
  output.set(header, 0);
  output.set(rgba, 4);
  writeFileSync(outPath, output);
  return output.byteLength;
}

function main() {
  let totalConverted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const region of REGIONS) {
    const blpDirFull = resolve(ROOT, region.blpDir);
    if (!existsSync(blpDirFull)) {
      console.warn(`  WARN: dir not found: ${region.blpDir}`);
      continue;
    }

    const blpFiles = readdirSync(blpDirFull).filter(f => f.toLowerCase().endsWith('.blp'));
    const outDirFull = resolve(ROOT, region.outDir);
    mkdirSync(outDirFull, { recursive: true });

    let converted = 0;
    let skipped = 0;
    let errors = 0;

    for (const blpFile of blpFiles) {
      const stem = basename(blpFile, extname(blpFile));
      const outPath = resolve(outDirFull, `${stem}.tex`);

      if (existsSync(outPath)) {
        skipped++;
        continue;
      }

      try {
        const blpFullPath = resolve(blpDirFull, blpFile);
        const blpData = readFileSync(blpFullPath);
        const blp = new Blp();
        blp.load(blpData as any);
        const image = blp.getImage(0, BLP_IMAGE_FORMAT.IMAGE_ABGR8888);
        const rgba = new Uint8Array(image.data);
        writeTexFile(outPath, image.width, image.height, rgba);
        converted++;
      } catch (err: any) {
        console.error(`  ERROR: ${region.blpDir}/${blpFile} — ${err.message}`);
        errors++;
      }
    }

    const regionName = region.outDir.split('/').pop();
    console.log(`  ${regionName}: ${converted} converted, ${skipped} skipped, ${errors} errors (${blpFiles.length} total)`);
    totalConverted += converted;
    totalSkipped += skipped;
    totalErrors += errors;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Converted: ${totalConverted}`);
  console.log(`Skipped:   ${totalSkipped}`);
  console.log(`Errors:    ${totalErrors}`);
}

main();

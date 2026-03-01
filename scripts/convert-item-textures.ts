/**
 * Convert item armor BLP textures to .tex files for browser consumption.
 *
 * Reads BLPs from data/extracted/Item/TextureComponents/{Region}/
 * and writes .tex files to public/item-textures/{Region}/
 *
 * .tex format: uint16 width + uint16 height + raw RGBA pixels (same as skin.tex)
 *
 * Usage: bun run scripts/convert-item-textures.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, basename, extname } from 'path';

const { Blp, BLP_IMAGE_FORMAT } = await import('@wowserhq/format');

const ROOT = resolve(import.meta.dirname, '..');

interface ItemTextureConfig {
  blpPath: string; // relative to ROOT
  outDir: string;  // relative to ROOT
}

const ITEM_TEXTURES: ItemTextureConfig[] = [
  // Chest — displayId 3413, Plate_A_01Silver
  {
    blpPath: 'data/extracted/Item/TextureComponents/ArmUpperTexture/Plate_A_01Silver_Sleeve_AU_U.blp',
    outDir:  'public/item-textures/ArmUpperTexture',
  },
  {
    blpPath: 'data/extracted/Item/TextureComponents/TorsoUpperTexture/Plate_A_01Silver_Chest_TU_U.blp',
    outDir:  'public/item-textures/TorsoUpperTexture',
  },
  {
    blpPath: 'data/extracted/Item/TextureComponents/TorsoLowerTexture/Plate_A_01Silver_Chest_TL_U.blp',
    outDir:  'public/item-textures/TorsoLowerTexture',
  },
];

function decodeBlp(blpPath: string): { width: number; height: number; rgba: Uint8Array } {
  const blpData = readFileSync(resolve(ROOT, blpPath));
  const blp = new Blp();
  blp.load(blpData as any);
  const image = blp.getImage(0, BLP_IMAGE_FORMAT.IMAGE_ABGR8888);
  return { width: image.width, height: image.height, rgba: new Uint8Array(image.data) };
}

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
  console.log(`Converting ${ITEM_TEXTURES.length} item armor textures...\n`);
  let converted = 0;

  for (const config of ITEM_TEXTURES) {
    const baseName = basename(config.blpPath, extname(config.blpPath));
    const outDir = resolve(ROOT, config.outDir);
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, `${baseName}.tex`);

    try {
      const { width, height, rgba } = decodeBlp(config.blpPath);
      const size = writeTexFile(outPath, width, height, rgba);
      console.log(`  OK: ${config.outDir}/${baseName}.tex (${width}x${height}, ${size} bytes)`);
      converted++;
    } catch (err: any) {
      console.error(`  ERROR: ${config.blpPath} — ${err.message}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Converted: ${converted} / ${ITEM_TEXTURES.length}`);
}

main();

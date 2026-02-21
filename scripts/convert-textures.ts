/**
 * Convert BLP textures to raw RGBA binary files for browser consumption.
 *
 * Uses @wowserhq/format's Blp parser to decode BLP → ABGR8888 pixel data,
 * then swizzles to RGBA and writes as a .tex file (raw pixels + small header).
 *
 * Output format (.tex):
 *   uint16 width, uint16 height, then width*height*4 bytes of RGBA pixels
 *
 * The browser loads these with fetch() and creates a THREE.DataTexture.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// @wowserhq/format exports
const { Blp, BLP_IMAGE_FORMAT } = await import('@wowserhq/format');

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = resolve(ROOT, 'public/models/textures');

interface TextureSource {
  name: string;
  blpPath: string;
}

// Textures to convert: existing patch data + extracted base vanilla textures
const TEXTURES: TextureSource[] = [
  // Existing patch textures
  {
    name: 'human-male-skin',
    blpPath: 'data/patch/patch-3/Character/Human/Male/HumanMale_Magic.blp',
  },
  {
    name: 'human-male-hair',
    blpPath: 'data/patch/patch-6/Character/Human/Hair04_07.blp',
  },
  // Extracted base vanilla textures (for compositing)
  // Base skin (skin color 0)
  {
    name: 'base-skin-00',
    blpPath: 'data/extracted/Character/Human/Male/HumanMaleSkin00_00.blp',
  },
  // Face textures (face variation 0, skin color 0)
  {
    name: 'face-lower-00-00',
    blpPath: 'data/extracted/Character/Human/Male/HumanMaleFaceLower00_00.blp',
  },
  {
    name: 'face-upper-00-00',
    blpPath: 'data/extracted/Character/Human/Male/HumanMaleFaceUpper00_00.blp',
  },
  // Underwear pelvis (skin color 0)
  {
    name: 'underwear-pelvis-00',
    blpPath: 'data/extracted/Character/Human/Male/HumanMaleNakedPelvisSkin00_00.blp',
  },
];

function convertBlpToTex(blpPath: string, outPath: string) {
  const blpData = readFileSync(resolve(ROOT, blpPath));
  const blp = new Blp();
  blp.load(blpData);

  // Get ABGR8888 pixel data (mip level 0)
  // Despite the name, ABGR8888 describes the 32-bit int layout (A=MSB, R=LSB).
  // In memory on little-endian systems (JS typed arrays), bytes are: R, G, B, A.
  // This is already RGBA byte order — no swizzle needed.
  const image = blp.getImage(0, BLP_IMAGE_FORMAT.IMAGE_ABGR8888);
  const { width, height, data } = image;
  const rgba = new Uint8Array(data);

  // Write .tex file: 4-byte header (uint16 width + uint16 height) + RGBA pixels
  const header = new Uint8Array(4);
  const headerView = new DataView(header.buffer);
  headerView.setUint16(0, width, true);
  headerView.setUint16(2, height, true);

  const output = new Uint8Array(4 + rgba.byteLength);
  output.set(header, 0);
  output.set(rgba, 4);

  writeFileSync(outPath, output);
  return { width, height, size: output.byteLength };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('Converting BLP textures to .tex format...\n');

  for (const tex of TEXTURES) {
    const outPath = resolve(OUT_DIR, `${tex.name}.tex`);
    const result = convertBlpToTex(tex.blpPath, outPath);
    console.log(`${tex.name}: ${result.width}x${result.height} → ${result.size} bytes`);
    console.log(`  Source: ${tex.blpPath}`);
    console.log(`  Output: ${outPath}`);
  }

  console.log('\nDone.');
}

main();

/**
 * Convert BLP textures to raw RGBA binary files for browser consumption.
 *
 * Uses @wowserhq/format's Blp parser to decode BLP -> ABGR8888 pixel data,
 * then writes as a .tex file (raw pixels + small header).
 *
 * Output format (.tex):
 *   uint16 width, uint16 height, then width*height*4 bytes of RGBA pixels
 *
 * For Human Male: build-time compositing of base skin + face + underwear layers
 * into a single skin.tex, matching what the WoW client does at runtime.
 *
 * Output per model:
 *   public/models/<slug>/textures/skin.tex
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const { Blp, BLP_IMAGE_FORMAT } = await import('@wowserhq/format');

const ROOT = resolve(import.meta.dirname, '..');

interface SkinTextureConfig {
  slug: string;
  blpPath: string | null; // null = solid color fallback
  fallbackColor?: [number, number, number, number]; // RGBA
}

// Region rectangles for character texture compositing (vanilla 256x256 atlas)
interface RegionRect { x: number; y: number; width: number; height: number; }

const REGION_RECTS: Record<string, RegionRect> = {
  FACE_UPPER:  { x: 0,   y: 160, width: 128, height: 32 },
  FACE_LOWER:  { x: 0,   y: 192, width: 128, height: 64 },
  LEG_UPPER:   { x: 128, y: 96,  width: 128, height: 64 },
};

const SKIN_TEXTURES: SkinTextureConfig[] = [
  { slug: 'blood-elf-male',    blpPath: 'data/patch/patch-5/Character/BloodElf/Male/BloodElfMaleSkin00_10.blp' },
  { slug: 'blood-elf-female',  blpPath: 'data/patch/patch-5/Character/BloodElf/Female/BloodElfFemaleSkin00_10.blp' },
  { slug: 'dwarf-male',        blpPath: 'data/patch/patch-5/Character/Dwarf/Male/DwarfMaleSkin00_09.blp' },
  { slug: 'dwarf-female',      blpPath: 'data/patch/patch-5/Character/Dwarf/Female/DwarfFemaleSkin00_09.blp' },
  { slug: 'gnome-male',        blpPath: 'data/patch/patch-5/Character/Gnome/Male/GnomeMaleSkin00_05.blp' },
  { slug: 'gnome-female',      blpPath: 'data/patch/patch-5/Character/Gnome/Female/GnomeFemaleSkin00_05.blp' },
  { slug: 'goblin-male',       blpPath: null, fallbackColor: [76, 120, 60, 255] },
  { slug: 'goblin-female',     blpPath: null, fallbackColor: [76, 120, 60, 255] },
  { slug: 'human-male',        blpPath: '__composited__' }, // Special: build-time compositing
  { slug: 'human-female',      blpPath: 'data/patch/patch-3/Character/Human/Female/HumanFemaleSkin00_102.blp' },
  { slug: 'night-elf-male',    blpPath: 'data/patch/patch-5/Character/NightElf/Male/NightElfMaleSkin00_09.blp' },
  { slug: 'night-elf-female',  blpPath: 'data/patch/patch-5/Character/NightElf/Female/NightElfFemaleSkin00_10.blp' },
  { slug: 'orc-male',          blpPath: 'data/patch/patch-3/Character/Orc/Male/OrcMaleSkin00_106.blp' },
  { slug: 'orc-female',        blpPath: 'data/patch/patch-8/Character/Orc/Female/OrcFemaleSkin00_100.blp' },
  { slug: 'scourge-male',      blpPath: 'data/patch/patch-5/Character/Scourge/Male/DeathKnightMaleSkin00_00.blp' },
  { slug: 'scourge-female',    blpPath: 'data/patch/patch-5/Character/Scourge/Female/ScourgeBloodWidowSkin00_00.blp' },
  { slug: 'tauren-male',       blpPath: 'data/patch/patch-5/Character/Tauren/Male/TaurenMaleSkin00_20.blp' },
  { slug: 'tauren-female',     blpPath: 'data/patch/patch-8/Character/Tauren/Female/TaurenFemaleSkin00_19.blp' },
  { slug: 'troll-male',        blpPath: 'data/patch/patch-3/Character/Troll/Male/TrollMaleSkin00_109.blp' },
  { slug: 'troll-female',      blpPath: 'data/patch/patch-5/Character/Troll/Female/ForestTrollFemaleSkin00_05.blp' },
];

// Also convert the Human Male hair texture
const HAIR_TEXTURE = {
  slug: 'human-male',
  name: 'hair',
  blpPath: 'data/patch/patch-6/Character/Human/Hair04_07.blp',
};

function decodeBlp(blpPath: string): { width: number; height: number; rgba: Uint8Array } {
  const blpData = readFileSync(resolve(ROOT, blpPath));
  const blp = new Blp();
  blp.load(blpData as any);
  const image = blp.getImage(0, BLP_IMAGE_FORMAT.IMAGE_ABGR8888);
  return { width: image.width, height: image.height, rgba: new Uint8Array(image.data) };
}

function writeTexFile(outPath: string, width: number, height: number, rgba: Uint8Array) {
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

function createSolidColorTex(width: number, height: number, color: [number, number, number, number]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4 + 0] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = color[3];
  }
  return rgba;
}

/**
 * Build-time compositing for Human Male:
 * Base skin + face lower + face upper + underwear pelvis → single RGBA buffer.
 * Uses raw pixel buffer manipulation (no canvas/DOM needed).
 */
function compositeHumanMale(): { width: number; height: number; rgba: Uint8Array } {
  const baseSkin = decodeBlp('data/extracted/Character/Human/Male/HumanMaleSkin00_00.blp');
  const faceLower = decodeBlp('data/extracted/Character/Human/Male/HumanMaleFaceLower00_00.blp');
  const faceUpper = decodeBlp('data/extracted/Character/Human/Male/HumanMaleFaceUpper00_00.blp');
  const underwear = decodeBlp('data/extracted/Character/Human/Male/HumanMaleNakedPelvisSkin00_00.blp');

  // Start with a copy of the base skin
  const output = new Uint8Array(baseSkin.rgba);
  const w = baseSkin.width;

  // Overlay a decoded texture into a region of the output buffer
  function overlayRegion(src: { width: number; height: number; rgba: Uint8Array }, region: RegionRect) {
    for (let dy = 0; dy < region.height; dy++) {
      for (let dx = 0; dx < region.width; dx++) {
        // Source pixel — scale if dimensions differ
        const sx = Math.floor(dx * src.width / region.width);
        const sy = Math.floor(dy * src.height / region.height);
        const srcIdx = (sy * src.width + sx) * 4;

        const a = src.rgba[srcIdx + 3];
        if (a === 0) continue; // fully transparent, skip

        const dstX = region.x + dx;
        const dstY = region.y + dy;
        const dstIdx = (dstY * w + dstX) * 4;

        if (a === 255) {
          // Fully opaque — direct copy
          output[dstIdx + 0] = src.rgba[srcIdx + 0];
          output[dstIdx + 1] = src.rgba[srcIdx + 1];
          output[dstIdx + 2] = src.rgba[srcIdx + 2];
          output[dstIdx + 3] = 255;
        } else {
          // Alpha blend
          const invA = 255 - a;
          output[dstIdx + 0] = (src.rgba[srcIdx + 0] * a + output[dstIdx + 0] * invA) >> 8;
          output[dstIdx + 1] = (src.rgba[srcIdx + 1] * a + output[dstIdx + 1] * invA) >> 8;
          output[dstIdx + 2] = (src.rgba[srcIdx + 2] * a + output[dstIdx + 2] * invA) >> 8;
          output[dstIdx + 3] = Math.min(255, output[dstIdx + 3] + a);
        }
      }
    }
  }

  overlayRegion(faceLower, REGION_RECTS.FACE_LOWER);
  overlayRegion(faceUpper, REGION_RECTS.FACE_UPPER);
  overlayRegion(underwear, REGION_RECTS.LEG_UPPER);

  return { width: baseSkin.width, height: baseSkin.height, rgba: output };
}

function main() {
  console.log(`Converting skin textures for ${SKIN_TEXTURES.length} models...\n`);

  let converted = 0;
  let fallbacks = 0;

  for (const config of SKIN_TEXTURES) {
    const outDir = resolve(ROOT, 'public/models', config.slug, 'textures');
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, 'skin.tex');

    if (config.blpPath === null) {
      // Solid color fallback
      const color = config.fallbackColor || [128, 128, 128, 255];
      const rgba = createSolidColorTex(64, 64, color);
      const size = writeTexFile(outPath, 64, 64, rgba);
      console.log(`${config.slug}: solid color fallback (${color.join(',')}) → ${size} bytes`);
      fallbacks++;
    } else if (config.blpPath === '__composited__') {
      // Human Male build-time compositing
      const { width, height, rgba } = compositeHumanMale();
      const size = writeTexFile(outPath, width, height, rgba);
      console.log(`${config.slug}: composited ${width}x${height} → ${size} bytes`);
      converted++;
    } else {
      // Standard BLP conversion
      const fullPath = resolve(ROOT, config.blpPath);
      if (!existsSync(fullPath)) {
        console.warn(`${config.slug}: MISSING ${config.blpPath} — skipping`);
        continue;
      }
      const { width, height, rgba } = decodeBlp(config.blpPath);
      const size = writeTexFile(outPath, width, height, rgba);
      console.log(`${config.slug}: ${width}x${height} → ${size} bytes`);
      converted++;
    }
  }

  // Convert hair texture for Human Male
  {
    const outDir = resolve(ROOT, 'public/models', HAIR_TEXTURE.slug, 'textures');
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, 'hair.tex');
    const { width, height, rgba } = decodeBlp(HAIR_TEXTURE.blpPath);
    const size = writeTexFile(outPath, width, height, rgba);
    console.log(`${HAIR_TEXTURE.slug}/hair: ${width}x${height} → ${size} bytes`);
    converted++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Textures converted: ${converted}`);
  console.log(`Solid color fallbacks: ${fallbacks}`);
  console.log(`Total: ${converted + fallbacks}`);
}

main();

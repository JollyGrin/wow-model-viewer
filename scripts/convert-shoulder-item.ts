/**
 * Convert shoulder M2 + BLP texture to web-ready format.
 *
 * Shoulders have paired L/R M2 files (pre-baked geometry, no mirroring).
 * IDI ModelName[0] = LShoulder_Foo.mdx, ModelName[1] = RShoulder_Foo.mdx
 * BLP texture is shared between L and R.
 *
 * Output per shoulder:
 *   public/items/shoulder/{slug}/left/model.bin + model.json
 *   public/items/shoulder/{slug}/right/model.bin + model.json  (when R exists)
 *   public/items/shoulder/{slug}/textures/main.tex
 *
 * Usage: bun run scripts/convert-shoulder-item.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, basename, extname } from 'path';

const { Blp, BLP_IMAGE_FORMAT } = await import('@wowserhq/format');

const ROOT = resolve(import.meta.dirname, '..');

const PATCH_DIRS = ['patch-9', 'patch-8', 'patch-7', 'patch-6', 'patch-5', 'patch-4', 'patch-3', 'patch-2'];

// --- Find shoulder dirs across patches (case-insensitive) ---

function findShoulderDirs(): Map<string, string> {
  const dirs = new Map<string, string>();
  for (const patchName of PATCH_DIRS) {
    const patchBase = resolve(ROOT, 'data/patch', patchName);
    if (!existsSync(patchBase)) continue;
    for (const itemCase of ['Item', 'item', 'ITEM']) {
      for (const ocCase of ['ObjectComponents', 'OBJECTCOMPONENTS']) {
        for (const sCase of ['Shoulder', 'SHOULDER', 'shoulder']) {
          const dir = resolve(patchBase, itemCase, ocCase, sCase);
          if (existsSync(dir)) {
            dirs.set(patchName, dir);
            break;
          }
        }
        if (dirs.has(patchName)) break;
      }
      if (dirs.has(patchName)) break;
    }
  }
  return dirs;
}

const shoulderDirs = findShoulderDirs();

// --- Build BLP index (highest patch wins) ---
const blpIndex = new Map<string, string>();
for (const [, dir] of shoulderDirs) {
  for (const f of readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.blp')) continue;
    const key = basename(f, extname(f)).toLowerCase();
    if (!blpIndex.has(key)) blpIndex.set(key, resolve(dir, f));
  }
}

// --- Build IDI texture lookup ---
interface DisplayRecord { ModelName: string[]; ModelTexture: string[]; }
const displayInfoRaw = readFileSync(resolve(ROOT, 'data/dbc/ItemDisplayInfo.json'), 'utf-8');
const displayRecords: DisplayRecord[] = JSON.parse(displayInfoRaw.split('\n')[14]);

// For shoulders, IDI ModelTexture[0] is the shared texture name
// Map: lowercase model stem (LShoulder_* or base) → ModelTexture
const shoulderTextureMap = new Map<string, string>();
for (const rec of displayRecords) {
  if (rec.ModelName?.[0] && rec.ModelTexture?.[0]) {
    const stem = basename(rec.ModelName[0], extname(rec.ModelName[0])).toLowerCase();
    if (stem.startsWith('lshoulder_') || stem.startsWith('rshoulder_')) {
      // Map the base name (strip L/RShoulder_ prefix) to texture
      const base = stem.replace(/^[lr]shoulder_/, '');
      if (!shoulderTextureMap.has(base)) {
        shoulderTextureMap.set(base, rec.ModelTexture[0]);
      }
    }
  }
}

// --- Discover shoulder M2s, group by base slug ---

interface ShoulderGroup {
  baseSlug: string;
  baseName: string; // original case base name (after stripping L/RShoulder_)
  leftPath?: string;
  rightPath?: string;
}

const shoulderGroups = new Map<string, ShoulderGroup>();

for (const patchName of PATCH_DIRS) {
  const dir = shoulderDirs.get(patchName);
  if (!dir) continue;

  for (const f of readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.m2')) continue;
    const stem = basename(f, extname(f));
    const stemLower = stem.toLowerCase();

    let side: 'left' | 'right';
    let baseName: string;

    if (stemLower.startsWith('lshoulder_')) {
      side = 'left';
      baseName = stem.slice('LShoulder_'.length);
    } else if (stemLower.startsWith('rshoulder_')) {
      side = 'right';
      baseName = stem.slice('RShoulder_'.length);
    } else {
      continue;
    }

    const baseSlug = baseName.toLowerCase().replace(/_/g, '-');

    let group = shoulderGroups.get(baseSlug);
    if (!group) {
      group = { baseSlug, baseName };
      shoulderGroups.set(baseSlug, group);
    }

    // Higher patch wins
    const path = resolve(dir, f);
    if (side === 'left' && !group.leftPath) group.leftPath = path;
    if (side === 'right' && !group.rightPath) group.rightPath = path;
  }
}

// --- M2 Parser ---

interface M2Arr { count: number; ofs: number; }

function parseItemM2(buf: Buffer) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  function arr(off: number): M2Arr {
    return { count: view.getUint32(off, true), ofs: view.getUint32(off + 4, true) };
  }
  let off = 0;
  const magic = buf.toString('ascii', 0, 4); off += 4;
  if (magic !== 'MD20') throw new Error(`Bad magic: ${magic}`);
  const version = view.getUint32(off, true); off += 4;
  if (version < 256 || version > 264) throw new Error(`Unexpected version ${version}`);
  off += 8; // name
  off += 4; // globalFlags
  off += 8; // globalSequences
  off += 8; // sequences
  off += 8; // sequenceLookup
  if (version === 256) off += 8; // playableAnimLookup (v256 extra)
  off += 8; // bones
  off += 8; // keyBoneLookup
  const vertices = arr(off); off += 8;
  const views = arr(off); off += 8;
  return { vertices, views, version, buf, view };
}

function parseItemView0(view: DataView, viewsArr: M2Arr) {
  function arr(off: number): M2Arr {
    return { count: view.getUint32(off, true), ofs: view.getUint32(off + 4, true) };
  }
  const viewOfs = viewsArr.ofs;
  const vertexIndices = arr(viewOfs);
  const triangleIndices = arr(viewOfs + 8);

  const remap = new Uint16Array(vertexIndices.count);
  for (let i = 0; i < vertexIndices.count; i++) {
    remap[i] = view.getUint16(vertexIndices.ofs + i * 2, true);
  }
  const rawTriangles = new Uint16Array(triangleIndices.count);
  for (let i = 0; i < triangleIndices.count; i++) {
    rawTriangles[i] = view.getUint16(triangleIndices.ofs + i * 2, true);
  }
  return { remap, rawTriangles };
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

const VERTEX_STRIDE = 32;

function convertShoulderM2(m2Path: string, outDir: string): { vertexCount: number; triangleCount: number } {
  const buf = readFileSync(m2Path);
  const m2 = parseItemM2(buf);
  const skin = parseItemView0(m2.view, m2.views);

  const vertexCount = skin.remap.length;
  const STRIDE_F32 = VERTEX_STRIDE / 4;
  const outBuf = new Float32Array(vertexCount * STRIDE_F32);

  for (let i = 0; i < vertexCount; i++) {
    const modelIdx = skin.remap[i];
    const srcOfs = m2.vertices.ofs + modelIdx * 48;
    const o = i * STRIDE_F32;
    outBuf[o + 0] = m2.view.getFloat32(srcOfs + 0, true);
    outBuf[o + 1] = m2.view.getFloat32(srcOfs + 4, true);
    outBuf[o + 2] = m2.view.getFloat32(srcOfs + 8, true);
    outBuf[o + 3] = m2.view.getFloat32(srcOfs + 20, true);
    outBuf[o + 4] = m2.view.getFloat32(srcOfs + 24, true);
    outBuf[o + 5] = m2.view.getFloat32(srcOfs + 28, true);
    outBuf[o + 6] = m2.view.getFloat32(srcOfs + 32, true);
    outBuf[o + 7] = m2.view.getFloat32(srcOfs + 36, true);
  }

  const indexBuffer = skin.rawTriangles;
  const maxIdx = Math.max(...Array.from(indexBuffer));
  if (maxIdx >= vertexCount) throw new Error(`Index ${maxIdx} out of range (${vertexCount} verts)`);

  const vertexBytes = new Uint8Array(outBuf.buffer);
  const indexBytes = new Uint8Array(indexBuffer.buffer, indexBuffer.byteOffset, indexBuffer.byteLength);
  const binData = new Uint8Array(vertexBytes.byteLength + indexBytes.byteLength);
  binData.set(vertexBytes, 0);
  binData.set(indexBytes, vertexBytes.byteLength);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'model.bin'), binData);

  const manifest = {
    vertexCount,
    indexCount: indexBuffer.length,
    triangleCount: Math.floor(indexBuffer.length / 3),
    vertexBufferSize: vertexBytes.byteLength,
    indexBufferSize: indexBytes.byteLength,
    vertexStride: VERTEX_STRIDE,
  };
  writeFileSync(resolve(outDir, 'model.json'), JSON.stringify(manifest, null, 2));

  return { vertexCount, triangleCount: manifest.triangleCount };
}

// --- Find companion BLP ---
function findShoulderBlp(baseName: string): string | null {
  const baseLower = baseName.toLowerCase();

  // 1. IDI lookup
  const modelTexture = shoulderTextureMap.get(baseLower);
  if (modelTexture) {
    const texLower = modelTexture.toLowerCase();
    const fromIdi = blpIndex.get(texLower);
    if (fromIdi) return fromIdi;
  }

  // 2. Try "shoulder_{baseName}" match
  const shoulderKey = `shoulder_${baseLower}`;
  const exact = blpIndex.get(shoulderKey);
  if (exact) return exact;

  // 3. Prefix match
  for (const [key, path] of blpIndex) {
    if (key.startsWith(shoulderKey) && key !== shoulderKey) return path;
  }

  return null;
}

// --- Main ---

function main() {
  console.log(`Discovered ${shoulderGroups.size} shoulder base models.\n`);

  let converted = 0;
  let skipped = 0;
  let missingBlp = 0;
  let errors = 0;
  let leftCount = 0;
  let rightCount = 0;

  for (const [, group] of shoulderGroups) {
    if (!group.leftPath) continue; // Must have at least L model

    const slugDir = resolve(ROOT, 'public/items/shoulder', group.baseSlug);
    const texDir = resolve(slugDir, 'textures');
    const texFile = resolve(texDir, 'main.tex');

    // Check if already fully converted
    const leftJson = resolve(slugDir, 'left', 'model.json');
    if (existsSync(leftJson)) {
      skipped++;
      continue;
    }

    // Find BLP
    const blpPath = findShoulderBlp(group.baseName);
    if (!blpPath) {
      missingBlp++;
      continue;
    }

    // Convert texture
    try {
      mkdirSync(texDir, { recursive: true });
      const blpData = readFileSync(blpPath);
      const blp = new Blp();
      blp.load(blpData as any);
      const image = blp.getImage(0, BLP_IMAGE_FORMAT.IMAGE_ABGR8888);
      writeTexFile(texFile, image.width, image.height, new Uint8Array(image.data));
    } catch (err: any) {
      console.error(`  TEX ERROR: ${group.baseSlug} — ${err.message}`);
      errors++;
      continue;
    }

    // Convert L model
    try {
      convertShoulderM2(group.leftPath, resolve(slugDir, 'left'));
      leftCount++;
    } catch (err: any) {
      console.error(`  L ERROR: ${group.baseSlug} — ${err.message}`);
      errors++;
      continue;
    }

    // Convert R model if available
    if (group.rightPath) {
      try {
        convertShoulderM2(group.rightPath, resolve(slugDir, 'right'));
        rightCount++;
      } catch (err: any) {
        console.error(`  R ERROR: ${group.baseSlug} — ${err.message}`);
        errors++;
      }
    }

    converted++;
  }

  console.log('=== Summary ===');
  console.log(`Converted:   ${converted} (of ${shoulderGroups.size} base models)`);
  console.log(`Left:        ${leftCount}`);
  console.log(`Right:       ${rightCount}`);
  console.log(`Skipped:     ${skipped} (already exists)`);
  console.log(`Missing BLP: ${missingBlp}`);
  console.log(`Errors:      ${errors}`);
}

main();

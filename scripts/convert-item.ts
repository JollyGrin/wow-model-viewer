/**
 * Convert item M2 + BLP texture to web-ready format.
 *
 * Dynamically discovers all weapon M2s across patches (highest patch wins).
 * Uses ItemDisplayInfo.json to look up the companion BLP texture name.
 *
 * Output vertex format (32 bytes per vertex):
 *   position  3×float32  12B  offset 0
 *   normal    3×float32  12B  offset 12
 *   uv        2×float32   8B  offset 24
 *
 * Output per item:
 *   public/items/{category}/{slug}/model.bin  (vertex buffer + index buffer)
 *   public/items/{category}/{slug}/model.json (manifest)
 *   public/items/{category}/{slug}/textures/main.tex
 *
 * Usage: bun run scripts/convert-item.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, basename, extname } from 'path';

const { Blp, BLP_IMAGE_FORMAT } = await import('@wowserhq/format');

const ROOT = resolve(import.meta.dirname, '..');

// Patch directories in reverse order (highest patch wins)
const PATCH_DIRS = ['patch-9', 'patch-8', 'patch-7', 'patch-6', 'patch-5', 'patch-4', 'patch-3', 'patch-2'];
const WEAPON_SUBPATH = 'Item/ObjectComponents/Weapon';

// --- Build ItemDisplayInfo texture lookup: modelName_stem_lower → modelTexture ---

interface DisplayRecord {
  ModelName: string[];
  ModelTexture: string[];
}

const displayInfoRaw = readFileSync(resolve(ROOT, 'data/dbc/ItemDisplayInfo.json'), 'utf-8');
// Line 15 (1-indexed) is the JSON array; 14 lines of tool log precede it
const displayRecords: DisplayRecord[] = JSON.parse(displayInfoRaw.split('\n')[14]);

// Map: lowercase stem (no ext) → first ModelTexture value
const modelTextureMap = new Map<string, string>();
for (const rec of displayRecords) {
  if (rec.ModelName?.[0] && rec.ModelTexture?.[0]) {
    const stem = basename(rec.ModelName[0], extname(rec.ModelName[0])).toLowerCase();
    if (!modelTextureMap.has(stem)) {
      modelTextureMap.set(stem, rec.ModelTexture[0]);
    }
  }
}

// --- Build BLP index across all patches (highest patch wins) ---
// Map: lowercase_filename_no_ext → full absolute path

const blpIndex = new Map<string, string>();

// Process patches in REVERSE order so earlier iteration (higher patch) wins
for (const patchName of PATCH_DIRS) {
  const weaponDir = resolve(ROOT, 'data/patch', patchName, WEAPON_SUBPATH);
  if (!existsSync(weaponDir)) continue;

  const files = readdirSync(weaponDir);
  for (const f of files) {
    if (!f.toLowerCase().endsWith('.blp')) continue;
    const key = basename(f, extname(f)).toLowerCase();
    // Higher patch set first — only set if not already set (higher patch takes priority)
    // Since we iterate from patch-9 down, the first write wins
    if (!blpIndex.has(key)) {
      blpIndex.set(key, resolve(weaponDir, f));
    }
  }
}

// --- Discover M2 files across all patches (highest patch wins) ---

interface WeaponM2 {
  slug: string;
  stem: string;
  m2Path: string;
}

const weaponM2s: WeaponM2[] = [];
const seenSlugs = new Set<string>();

for (const patchName of PATCH_DIRS) {
  const weaponDir = resolve(ROOT, 'data/patch', patchName, WEAPON_SUBPATH);
  if (!existsSync(weaponDir)) continue;

  const files = readdirSync(weaponDir);
  for (const f of files) {
    if (!f.toLowerCase().endsWith('.m2')) continue;
    const stem = basename(f, extname(f));
    const slug = stem.toLowerCase().replace(/_/g, '-');
    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    weaponM2s.push({ slug, stem, m2Path: resolve(weaponDir, f) });
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
  if (version < 256 || version > 264) throw new Error(`Unexpected version ${version} (expected 256–264)`);

  off += 8; // name M2Array
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

function parseItemView0(_buf: Buffer, view: DataView, viewsArr: M2Arr) {
  function arr(off: number): M2Arr {
    return { count: view.getUint32(off, true), ofs: view.getUint32(off + 4, true) };
  }

  const viewOfs = viewsArr.ofs;
  const vertexIndices = arr(viewOfs);
  const triangleIndices = arr(viewOfs + 8);
  const submeshesArr = arr(viewOfs + 24);

  const remap = new Uint16Array(vertexIndices.count);
  for (let i = 0; i < vertexIndices.count; i++) {
    remap[i] = view.getUint16(vertexIndices.ofs + i * 2, true);
  }

  const rawTriangles = new Uint16Array(triangleIndices.count);
  for (let i = 0; i < triangleIndices.count; i++) {
    rawTriangles[i] = view.getUint16(triangleIndices.ofs + i * 2, true);
  }

  interface Submesh { vertexStart: number; vertexCount: number; indexStart: number; indexCount: number; }
  const submeshes: Submesh[] = [];
  const SUBMESH_SIZE = 32;
  for (let s = 0; s < submeshesArr.count; s++) {
    const so = submeshesArr.ofs + s * SUBMESH_SIZE;
    submeshes.push({
      vertexStart: view.getUint16(so + 4, true),
      vertexCount: view.getUint16(so + 6, true),
      indexStart:  view.getUint16(so + 8, true),
      indexCount:  view.getUint16(so + 10, true),
    });
  }

  return { remap, rawTriangles, submeshes };
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

// Find the companion BLP for an M2 stem.
// Strategy:
//   1. ItemDisplayInfo lookup: find ModelTexture for this M2 stem, look up that BLP
//   2. Exact stem match: {stem}.blp
//   3. First BLP starting with stem (any color variant)
function findCompanionBlp(stem: string): string | null {
  const stemLower = stem.toLowerCase();

  // 1. ItemDisplayInfo lookup
  const modelTexture = modelTextureMap.get(stemLower);
  if (modelTexture) {
    const texLower = modelTexture.toLowerCase();
    const fromDbi = blpIndex.get(texLower);
    if (fromDbi) return fromDbi;
  }

  // 2. Exact stem match
  const exact = blpIndex.get(stemLower);
  if (exact) return exact;

  // 3. First BLP starting with stem (color variant)
  const prefix = stemLower;
  for (const [key, path] of blpIndex) {
    if (key.startsWith(prefix) && key !== prefix) {
      return path;
    }
  }

  return null;
}

const VERTEX_STRIDE = 32;

function convertWeapon(weapon: WeaponM2): {
  vertexCount: number; triangleCount: number; submeshCount: number; binSize: number; texSize: number; texDims: string;
} {
  const outDir = resolve(ROOT, 'public/items/weapon', weapon.slug);
  const outBin = resolve(outDir, 'model.bin');
  const outJson = resolve(outDir, 'model.json');
  const outTexDir = resolve(outDir, 'textures');
  const outTex = resolve(outTexDir, 'main.tex');

  const buf = readFileSync(weapon.m2Path);
  const m2 = parseItemM2(buf);
  const skin = parseItemView0(buf, m2.view, m2.views);

  const vertexCount = skin.remap.length;
  const STRIDE_F32 = VERTEX_STRIDE / 4;
  const outBuf = new Float32Array(vertexCount * STRIDE_F32);

  for (let i = 0; i < vertexCount; i++) {
    const modelIdx = skin.remap[i];
    const srcOfs = m2.vertices.ofs + modelIdx * 48;
    const o = i * STRIDE_F32;

    outBuf[o + 0] = m2.view.getFloat32(srcOfs + 0,  true);
    outBuf[o + 1] = m2.view.getFloat32(srcOfs + 4,  true);
    outBuf[o + 2] = m2.view.getFloat32(srcOfs + 8,  true);
    outBuf[o + 3] = m2.view.getFloat32(srcOfs + 20, true);
    outBuf[o + 4] = m2.view.getFloat32(srcOfs + 24, true);
    outBuf[o + 5] = m2.view.getFloat32(srcOfs + 28, true);
    outBuf[o + 6] = m2.view.getFloat32(srcOfs + 32, true);
    outBuf[o + 7] = m2.view.getFloat32(srcOfs + 36, true);
  }

  const indexBuffer = skin.rawTriangles;
  const maxIdx = Math.max(...Array.from(indexBuffer));
  if (maxIdx >= vertexCount) {
    throw new Error(`Index ${maxIdx} out of range (${vertexCount} verts)`);
  }

  const vertexBytes = new Uint8Array(outBuf.buffer);
  const indexBytes = new Uint8Array(indexBuffer.buffer, indexBuffer.byteOffset, indexBuffer.byteLength);
  const binData = new Uint8Array(vertexBytes.byteLength + indexBytes.byteLength);
  binData.set(vertexBytes, 0);
  binData.set(indexBytes, vertexBytes.byteLength);

  mkdirSync(outTexDir, { recursive: true });
  writeFileSync(outBin, binData);

  const manifest = {
    vertexCount,
    indexCount: indexBuffer.length,
    triangleCount: Math.floor(indexBuffer.length / 3),
    vertexBufferSize: vertexBytes.byteLength,
    indexBufferSize: indexBytes.byteLength,
    vertexStride: VERTEX_STRIDE,
  };
  writeFileSync(outJson, JSON.stringify(manifest, null, 2));

  // Convert BLP texture
  const blpPath = findCompanionBlp(weapon.stem)!;
  const blpData = readFileSync(blpPath);
  const blp = new Blp();
  blp.load(blpData as any);
  const image = blp.getImage(0, BLP_IMAGE_FORMAT.IMAGE_ABGR8888);
  const rgba = new Uint8Array(image.data);
  const texBytes = writeTexFile(outTex, image.width, image.height, rgba);

  return {
    vertexCount,
    triangleCount: manifest.triangleCount,
    submeshCount: skin.submeshes.length,
    binSize: binData.byteLength,
    texSize: texBytes,
    texDims: `${image.width}x${image.height}`,
  };
}

// --- Main ---

function main() {
  console.log(`Discovered ${weaponM2s.length} weapon M2s across all patches.\n`);

  let converted = 0;
  let skipped = 0;
  let missingBlp = 0;
  let errors = 0;

  for (const weapon of weaponM2s) {
    const outJson = resolve(ROOT, 'public/items/weapon', weapon.slug, 'model.json');

    // Skip if already converted
    if (existsSync(outJson)) {
      skipped++;
      continue;
    }

    // Check companion BLP exists
    const blpPath = findCompanionBlp(weapon.stem);
    if (!blpPath) {
      console.warn(`  SKIP (no BLP): ${weapon.slug}`);
      missingBlp++;
      continue;
    }

    try {
      const result = convertWeapon(weapon);
      console.log(`  OK: ${weapon.slug} — ${result.vertexCount}v ${result.triangleCount}t ${result.texDims}`);
      converted++;
    } catch (err: any) {
      console.error(`  ERROR: ${weapon.slug} — ${err.message}`);
      errors++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Converted:   ${converted}`);
  console.log(`Skipped:     ${skipped} (already exists)`);
  console.log(`Missing BLP: ${missingBlp}`);
  console.log(`Errors:      ${errors}`);
}

main();

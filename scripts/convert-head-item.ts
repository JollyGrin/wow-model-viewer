/**
 * Convert helmet M2 + BLP texture to web-ready format.
 *
 * Helmets are race-gender-specific: each base model (e.g., Helm_Plate_D_02)
 * has up to 20 variants (HuM, HuF, OrM, OrF, etc.) as separate M2 files.
 * The BLP texture is shared across all race-gender variants.
 *
 * Output per helmet variant:
 *   public/items/head/{slug}/{race-gender}/model.bin
 *   public/items/head/{slug}/{race-gender}/model.json
 *   public/items/head/{slug}/textures/main.tex  (shared texture at slug level)
 *
 * Usage: bun run scripts/convert-head-item.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, basename, extname } from 'path';

const { Blp, BLP_IMAGE_FORMAT } = await import('@wowserhq/format');

const ROOT = resolve(import.meta.dirname, '..');

// Patch directories in reverse order (highest patch wins)
const PATCH_DIRS = ['patch-9', 'patch-8', 'patch-7', 'patch-6', 'patch-5', 'patch-4', 'patch-3', 'patch-2'];

// Race-gender suffix → model slug mapping
const RACE_GENDER_SUFFIXES: Record<string, string> = {
  'hum': 'human-male', 'huf': 'human-female',
  'orm': 'orc-male', 'orf': 'orc-female',
  'dwm': 'dwarf-male', 'dwf': 'dwarf-female',
  'nim': 'night-elf-male', 'nif': 'night-elf-female',
  'scm': 'scourge-male', 'scf': 'scourge-female',
  'tam': 'tauren-male', 'taf': 'tauren-female',
  'gnm': 'gnome-male', 'gnf': 'gnome-female',
  'trm': 'troll-male', 'trf': 'troll-female',
  'bem': 'blood-elf-male', 'bef': 'blood-elf-female',
  'gom': 'goblin-male', 'gof': 'goblin-female',
};

// --- Build BLP index across all patches (Head dir, highest patch wins) ---
const blpIndex = new Map<string, string>(); // lowercase name (no ext) → full path

function findHeadDirs(): Map<string, string> {
  const dirs = new Map<string, string>(); // patchName → resolved path
  for (const patchName of PATCH_DIRS) {
    const patchBase = resolve(ROOT, 'data/patch', patchName);
    if (!existsSync(patchBase)) continue;
    // Case-insensitive find: check common casing variants
    for (const itemCase of ['Item', 'item', 'ITEM']) {
      for (const ocCase of ['ObjectComponents', 'OBJECTCOMPONENTS']) {
        for (const headCase of ['Head', 'HEAD', 'head']) {
          const dir = resolve(patchBase, itemCase, ocCase, headCase);
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

const headDirs = findHeadDirs();

for (const [, dir] of headDirs) {
  for (const f of readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.blp')) continue;
    const key = basename(f, extname(f)).toLowerCase();
    if (!blpIndex.has(key)) blpIndex.set(key, resolve(dir, f));
  }
}

// --- Build ItemDisplayInfo texture lookup ---
interface DisplayRecord {
  ModelName: string[];
  ModelTexture: string[];
}
const displayInfoRaw = readFileSync(resolve(ROOT, 'data/dbc/ItemDisplayInfo.json'), 'utf-8');
const displayRecords: DisplayRecord[] = JSON.parse(displayInfoRaw.split('\n')[14]);

// Map: lowercase helm stem (no ext, no race suffix) → first ModelTexture value
const modelTextureMap = new Map<string, string>();
for (const rec of displayRecords) {
  if (rec.ModelName?.[0] && rec.ModelTexture?.[0]) {
    const stem = basename(rec.ModelName[0], extname(rec.ModelName[0])).toLowerCase();
    if (!modelTextureMap.has(stem)) {
      modelTextureMap.set(stem, rec.ModelTexture[0]);
    }
  }
}

// --- Discover helmet M2 files, group by base slug ---

interface HelmetVariant {
  raceGender: string; // e.g., 'human-male'
  m2Path: string;
}

interface HelmetGroup {
  baseSlug: string;  // e.g., 'helm-plate-d-02'
  baseStem: string;  // e.g., 'Helm_Plate_D_02' (original case from first file found)
  variants: Map<string, HelmetVariant>; // raceGender → variant (highest patch wins)
}

const helmetGroups = new Map<string, HelmetGroup>(); // baseSlug → group

for (const patchName of PATCH_DIRS) {
  const dir = headDirs.get(patchName);
  if (!dir) continue;

  for (const f of readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.m2')) continue;
    const stem = basename(f, extname(f));
    const stemLower = stem.toLowerCase();

    // Extract race-gender suffix: last 2-3 chars after underscore
    const lastUnder = stemLower.lastIndexOf('_');
    if (lastUnder < 0) continue; // No underscore = not a race-specific helmet

    const suffix = stemLower.slice(lastUnder + 1);
    const raceGender = RACE_GENDER_SUFFIXES[suffix];
    if (!raceGender) continue; // Not a recognized race-gender suffix

    const baseStem = stem.slice(0, lastUnder);
    const baseSlug = baseStem.toLowerCase().replace(/_/g, '-');

    let group = helmetGroups.get(baseSlug);
    if (!group) {
      group = { baseSlug, baseStem, variants: new Map() };
      helmetGroups.set(baseSlug, group);
    }

    // Higher patch was iterated first, so only set if not already present
    if (!group.variants.has(raceGender)) {
      group.variants.set(raceGender, { raceGender, m2Path: resolve(dir, f) });
    }
  }
}

// --- M2 Parser (reuse from convert-item.ts) ---

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

// --- Find companion BLP for a helmet base stem ---
function findHelmetBlp(baseStem: string): string | null {
  const stemLower = baseStem.toLowerCase();

  // 1. IDI lookup: baseStem → ModelTexture
  const modelTexture = modelTextureMap.get(stemLower);
  if (modelTexture) {
    const texLower = modelTexture.toLowerCase();
    const fromIdi = blpIndex.get(texLower);
    if (fromIdi) return fromIdi;
  }

  // 2. Exact match
  const exact = blpIndex.get(stemLower);
  if (exact) return exact;

  // 3. Prefix match (color variants)
  for (const [key, path] of blpIndex) {
    if (key.startsWith(stemLower) && key !== stemLower) return path;
  }

  return null;
}

// --- Convert a single helmet variant M2 ---
const VERTEX_STRIDE = 32;

function convertHelmetVariant(m2Path: string, outDir: string): {
  vertexCount: number; triangleCount: number;
} {
  const outBin = resolve(outDir, 'model.bin');
  const outJson = resolve(outDir, 'model.json');

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
  if (maxIdx >= vertexCount) {
    throw new Error(`Index ${maxIdx} out of range (${vertexCount} verts)`);
  }

  const vertexBytes = new Uint8Array(outBuf.buffer);
  const indexBytes = new Uint8Array(indexBuffer.buffer, indexBuffer.byteOffset, indexBuffer.byteLength);
  const binData = new Uint8Array(vertexBytes.byteLength + indexBytes.byteLength);
  binData.set(vertexBytes, 0);
  binData.set(indexBytes, vertexBytes.byteLength);

  mkdirSync(outDir, { recursive: true });
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

  return { vertexCount, triangleCount: manifest.triangleCount };
}

// --- Main ---

function main() {
  console.log(`Discovered ${helmetGroups.size} helmet base models.\n`);

  let totalConverted = 0;
  let totalVariants = 0;
  let totalSkipped = 0;
  let missingBlp = 0;
  let errors = 0;

  for (const [, group] of helmetGroups) {
    const slugDir = resolve(ROOT, 'public/items/head', group.baseSlug);

    // Check if texture already converted
    const texDir = resolve(slugDir, 'textures');
    const texFile = resolve(texDir, 'main.tex');
    const texExists = existsSync(texFile);

    // Find BLP for this helmet
    let blpConverted = texExists;
    if (!texExists) {
      const blpPath = findHelmetBlp(group.baseStem);
      if (!blpPath) {
        missingBlp++;
        continue;
      }

      // Convert shared texture
      try {
        mkdirSync(texDir, { recursive: true });
        const blpData = readFileSync(blpPath);
        const blp = new Blp();
        blp.load(blpData as any);
        const image = blp.getImage(0, BLP_IMAGE_FORMAT.IMAGE_ABGR8888);
        writeTexFile(texFile, image.width, image.height, new Uint8Array(image.data));
        blpConverted = true;
      } catch (err: any) {
        console.error(`  TEX ERROR: ${group.baseSlug} — ${err.message}`);
        errors++;
        continue;
      }
    }

    if (!blpConverted) continue;

    // Convert each race-gender variant
    let variantsConverted = 0;
    for (const [rg, variant] of group.variants) {
      const variantDir = resolve(slugDir, rg);
      const variantJson = resolve(variantDir, 'model.json');

      if (existsSync(variantJson)) {
        totalSkipped++;
        variantsConverted++;
        continue;
      }

      try {
        convertHelmetVariant(variant.m2Path, variantDir);
        variantsConverted++;
        totalVariants++;
      } catch (err: any) {
        console.error(`  M2 ERROR: ${group.baseSlug}/${rg} — ${err.message}`);
        errors++;
      }
    }

    if (variantsConverted > 0) {
      totalConverted++;
    }
  }

  console.log('=== Summary ===');
  console.log(`Helmet models:   ${totalConverted} (of ${helmetGroups.size} base models)`);
  console.log(`Variants:        ${totalVariants} new + ${totalSkipped} skipped`);
  console.log(`Missing BLP:     ${missingBlp}`);
  console.log(`Errors:          ${errors}`);
}

main();

/**
 * Extract item M2 models + BLP textures from MPQ archives to web-ready format.
 *
 * Handles 4 item types in a single run: weapon, head, shoulder, shield.
 * Mounts model.MPQ, texture.MPQ, patch.MPQ — patch wins on collision.
 *
 * Uses MPQ search() to enumerate files, then applies the same 3-tier BLP
 * lookup (IDI → exact match → prefix match) used by the patch-based scripts.
 *
 * Output vertex format (32 bytes per vertex):
 *   position  3×float32  12B  offset 0
 *   normal    3×float32  12B  offset 12
 *   uv        2×float32   8B  offset 24
 *
 * Output structures:
 *   Weapons/Shields: public/items/{weapon|shield}/{slug}/model.bin + model.json + textures/{tex-slug}.tex (one per variant)
 *   Helmets: public/items/head/{slug}/{race-gender}/model.bin + model.json + shared textures/{tex-slug}.tex
 *   Shoulders: public/items/shoulder/{slug}/{left|right}/model.bin + model.json + shared textures/{tex-slug}.tex
 *
 * Usage: bun run scripts/extract-mpq-items.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, basename, extname } from 'path';

const { Blp, BLP_IMAGE_FORMAT } = await import('@wowserhq/format');
const { FS, MPQ } = await import('@wowserhq/stormjs');

const ROOT = resolve(import.meta.dirname, '..');
const DATA_DIR = resolve(ROOT, 'data/model');

// ─── M2 Parser ──────────────────────────────────────────────────────────────

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

// ─── Helpers ────────────────────────────────────────────────────────────────

const VERTEX_STRIDE = 32;
const STRIDE_F32 = VERTEX_STRIDE / 4;

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

function convertM2ToModelFiles(m2Data: Buffer, outDir: string): { vertexCount: number; triangleCount: number } {
  const m2 = parseItemM2(m2Data);
  const skin = parseItemView0(m2.view, m2.views);

  const vertexCount = skin.remap.length;
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

function convertBlpToTex(blpData: Buffer, outPath: string): void {
  const blp = new Blp();
  blp.load(blpData as any);
  const image = blp.getImage(0, BLP_IMAGE_FORMAT.IMAGE_ABGR8888);
  const rgba = new Uint8Array(image.data);
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  writeTexFile(outPath, image.width, image.height, rgba);
}

function readMpqFile(mpq: any, path: string): Buffer {
  const file = mpq.openFile(path);
  const data = file.read();
  file.close();
  // stormjs returns Uint8Array, wrap as Node.js Buffer for .toString() etc.
  return Buffer.from(data);
}

// ─── IDI Lookup ─────────────────────────────────────────────────────────────

interface DisplayRecord {
  ModelName: string[];
  ModelTexture: string[];
}

const displayInfoRaw = readFileSync(resolve(ROOT, 'data/dbc/ItemDisplayInfo.json'), 'utf-8');
const displayRecords: DisplayRecord[] = JSON.parse(displayInfoRaw.split('\n')[14]);

// Helmet race-gender suffix → slug mapping (placed here because helmetBaseToTextures uses it)
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

// Map: lowercase model stem (no ext) → ALL unique ModelTexture values
const m2StemToTextures = new Map<string, Set<string>>();
for (const rec of displayRecords) {
  if (rec.ModelName?.[0] && rec.ModelTexture?.[0]) {
    const stem = basename(rec.ModelName[0], extname(rec.ModelName[0])).toLowerCase();
    if (!m2StemToTextures.has(stem)) m2StemToTextures.set(stem, new Set());
    m2StemToTextures.get(stem)!.add(rec.ModelTexture[0]);
  }
}

// Shoulder-specific: strips L/RShoulder_ prefix → ALL unique ModelTexture values
const shoulderBaseToTextures = new Map<string, Set<string>>();
for (const rec of displayRecords) {
  if (rec.ModelName?.[0] && rec.ModelTexture?.[0]) {
    const stem = basename(rec.ModelName[0], extname(rec.ModelName[0])).toLowerCase();
    if (stem.startsWith('lshoulder_') || stem.startsWith('rshoulder_')) {
      const base = stem.replace(/^[lr]shoulder_/, '');
      if (!shoulderBaseToTextures.has(base)) shoulderBaseToTextures.set(base, new Set());
      shoulderBaseToTextures.get(base)!.add(rec.ModelTexture[0]);
    }
  }
}

// Helmet-specific: strips race-gender suffix → ALL unique ModelTexture values
const helmetBaseToTextures = new Map<string, Set<string>>();
for (const rec of displayRecords) {
  if (rec.ModelName?.[0] && rec.ModelTexture?.[0]) {
    const stem = basename(rec.ModelName[0], extname(rec.ModelName[0])).toLowerCase();
    const lastUnder = stem.lastIndexOf('_');
    if (lastUnder >= 0) {
      const suffix = stem.slice(lastUnder + 1);
      if (RACE_GENDER_SUFFIXES[suffix]) {
        const baseStem = stem.slice(0, lastUnder);
        if (!helmetBaseToTextures.has(baseStem)) helmetBaseToTextures.set(baseStem, new Set());
        helmetBaseToTextures.get(baseStem)!.add(rec.ModelTexture[0]);
      }
    }
  }
}

// ─── MPQ Setup ──────────────────────────────────────────────────────────────

console.log('Mounting MPQ archives...');
FS.mkdir('/stormjs');
FS.mount(FS.filesystems.NODEFS, { root: DATA_DIR }, '/stormjs');

// Open MPQs in priority order: patch > model/texture
// patch.MPQ overrides both model.MPQ and texture.MPQ
const mpqNames = ['patch.MPQ', 'model.MPQ', 'texture.MPQ'];
const mpqs: { name: string; mpq: any }[] = [];

for (const name of mpqNames) {
  try {
    const m = await MPQ.open(`/stormjs/${name}`, 'r');
    mpqs.push({ name, mpq: m });
    console.log(`  Opened ${name}`);
  } catch {
    console.log(`  Skipped ${name} (not found)`);
  }
}

// ─── Build M2 + BLP Indexes ────────────────────────────────────────────────

type FileIndex = Map<string, { mpqName: string; mpq: any; path: string }>;

function buildIndex(typeDir: string, ext: string): FileIndex {
  const index: FileIndex = new Map();
  const mask = `Item\\ObjectComponents\\${typeDir}\\*.${ext}`;

  for (const { name, mpq } of mpqs) {
    const results = mpq.search(mask);
    for (const r of results) {
      const key = basename(r.plainName, extname(r.plainName)).toLowerCase();
      // First MPQ in priority order wins (patch > model > texture)
      if (!index.has(key)) {
        index.set(key, { mpqName: name, mpq, path: r.fileName });
      }
    }
  }
  return index;
}

// ─── BLP Lookup ─────────────────────────────────────────────────────────────

/** Find a specific BLP by texture name in the BLP index. */
function findBlpByName(texName: string, blpIndex: FileIndex): { mpq: any; path: string } | null {
  return blpIndex.get(texName.toLowerCase()) ?? null;
}

/** Fallback BLP finder: exact match or prefix match (for M2s with no IDI entry). */
function findBlpFallback(stem: string, blpIndex: FileIndex): { mpq: any; path: string; blpStem: string } | null {
  const stemLower = stem.toLowerCase();

  // 1. Exact match
  const exact = blpIndex.get(stemLower);
  if (exact) return { ...exact, blpStem: stemLower };

  // 2. Prefix match (color variant)
  for (const [key, entry] of blpIndex) {
    if (key.startsWith(stemLower) && key !== stemLower) return { ...entry, blpStem: key };
  }

  return null;
}

/** Fallback BLP finder for shoulders. */
function findShoulderBlpFallback(baseName: string, blpIndex: FileIndex): { mpq: any; path: string; blpStem: string } | null {
  const baseLower = baseName.toLowerCase();
  const shoulderKey = `shoulder_${baseLower}`;

  const exact = blpIndex.get(shoulderKey);
  if (exact) return { ...exact, blpStem: shoulderKey };

  for (const [key, entry] of blpIndex) {
    if (key.startsWith(shoulderKey) && key !== shoulderKey) return { ...entry, blpStem: key };
  }

  return null;
}

/** Convert a BLP texture name to a slug for the textures/ dir. */
function texSlug(blpStem: string): string {
  return blpStem.toLowerCase().replace(/_/g, '-');
}

// ─── Process Weapons ────────────────────────────────────────────────────────

function processWeapons() {
  console.log('\n=== Weapons ===');
  const m2Index = buildIndex('Weapon', 'm2');
  const blpIndex = buildIndex('Weapon', 'blp');
  console.log(`  Found ${m2Index.size} unique M2s, ${blpIndex.size} unique BLPs in MPQs`);

  let convertedModels = 0, skippedModels = 0, convertedTextures = 0, missingBlp = 0, errors = 0;

  for (const [stemLower, m2Entry] of m2Index) {
    const slug = stemLower.replace(/_/g, '-');
    const outDir = resolve(ROOT, 'public/items/weapon', slug);
    const outJson = resolve(outDir, 'model.json');

    // Convert model geometry once
    if (!existsSync(outJson)) {
      try {
        const m2Data = readMpqFile(m2Entry.mpq, m2Entry.path);
        convertM2ToModelFiles(m2Data, outDir);
        convertedModels++;
      } catch (err: any) {
        errors++;
        if (errors <= 5) console.error(`  M2 ERROR: ${slug} — ${err.message}`);
        continue;
      }
    } else {
      skippedModels++;
    }

    // Convert all IDI texture variants
    const texNames = m2StemToTextures.get(stemLower);
    let anyTex = false;
    if (texNames) {
      for (const texName of texNames) {
        const ts = texSlug(texName);
        const texPath = resolve(outDir, 'textures', `${ts}.tex`);
        if (existsSync(texPath)) { anyTex = true; continue; }
        const blpEntry = findBlpByName(texName, blpIndex);
        if (!blpEntry) continue;
        try {
          const blpData = readMpqFile(blpEntry.mpq, blpEntry.path);
          convertBlpToTex(blpData, texPath);
          convertedTextures++;
          anyTex = true;
        } catch (err: any) {
          errors++;
          if (errors <= 5) console.error(`  TEX ERROR: ${slug}/${ts} — ${err.message}`);
        }
      }
    }

    // Fallback: prefix match for M2s with no IDI texture
    if (!anyTex) {
      const fb = findBlpFallback(stemLower, blpIndex);
      if (fb) {
        const ts = texSlug(fb.blpStem);
        const texPath = resolve(outDir, 'textures', `${ts}.tex`);
        if (!existsSync(texPath)) {
          try {
            const blpData = readMpqFile(fb.mpq, fb.path);
            convertBlpToTex(blpData, texPath);
            convertedTextures++;
          } catch (err: any) {
            errors++;
            if (errors <= 5) console.error(`  FB TEX ERROR: ${slug}/${ts} — ${err.message}`);
          }
        }
      } else {
        missingBlp++;
      }
    }
  }

  console.log(`  Models: ${convertedModels} new, ${skippedModels} skipped. Textures: ${convertedTextures} new. Missing BLP: ${missingBlp}, Errors: ${errors}`);
  return { convertedModels, skippedModels, convertedTextures, missingBlp, errors };
}

// ─── Process Shields ────────────────────────────────────────────────────────

function processShields() {
  console.log('\n=== Shields ===');
  const m2Index = buildIndex('Shield', 'm2');
  const blpIndex = buildIndex('Shield', 'blp');
  console.log(`  Found ${m2Index.size} unique M2s, ${blpIndex.size} unique BLPs in MPQs`);

  let convertedModels = 0, skippedModels = 0, convertedTextures = 0, missingBlp = 0, errors = 0;

  for (const [stemLower, m2Entry] of m2Index) {
    const slug = stemLower.replace(/_/g, '-');
    const outDir = resolve(ROOT, 'public/items/shield', slug);
    const outJson = resolve(outDir, 'model.json');

    if (!existsSync(outJson)) {
      try {
        const m2Data = readMpqFile(m2Entry.mpq, m2Entry.path);
        convertM2ToModelFiles(m2Data, outDir);
        convertedModels++;
      } catch (err: any) {
        errors++;
        if (errors <= 5) console.error(`  M2 ERROR: ${slug} — ${err.message}`);
        continue;
      }
    } else {
      skippedModels++;
    }

    const texNames = m2StemToTextures.get(stemLower);
    let anyTex = false;
    if (texNames) {
      for (const texName of texNames) {
        const ts = texSlug(texName);
        const texPath = resolve(outDir, 'textures', `${ts}.tex`);
        if (existsSync(texPath)) { anyTex = true; continue; }
        const blpEntry = findBlpByName(texName, blpIndex);
        if (!blpEntry) continue;
        try {
          const blpData = readMpqFile(blpEntry.mpq, blpEntry.path);
          convertBlpToTex(blpData, texPath);
          convertedTextures++;
          anyTex = true;
        } catch (err: any) {
          errors++;
          if (errors <= 5) console.error(`  TEX ERROR: ${slug}/${ts} — ${err.message}`);
        }
      }
    }

    if (!anyTex) {
      const fb = findBlpFallback(stemLower, blpIndex);
      if (fb) {
        const ts = texSlug(fb.blpStem);
        const texPath = resolve(outDir, 'textures', `${ts}.tex`);
        if (!existsSync(texPath)) {
          try {
            const blpData = readMpqFile(fb.mpq, fb.path);
            convertBlpToTex(blpData, texPath);
            convertedTextures++;
          } catch (err: any) {
            errors++;
            if (errors <= 5) console.error(`  FB TEX ERROR: ${slug}/${ts} — ${err.message}`);
          }
        }
      } else {
        missingBlp++;
      }
    }
  }

  console.log(`  Models: ${convertedModels} new, ${skippedModels} skipped. Textures: ${convertedTextures} new. Missing BLP: ${missingBlp}, Errors: ${errors}`);
  return { convertedModels, skippedModels, convertedTextures, missingBlp, errors };
}

// ─── Process Helmets ────────────────────────────────────────────────────────

function processHelmets() {
  console.log('\n=== Helmets ===');
  const m2Index = buildIndex('Head', 'm2');
  const blpIndex = buildIndex('Head', 'blp');
  console.log(`  Found ${m2Index.size} unique M2s, ${blpIndex.size} unique BLPs in MPQs`);

  // Group M2s by base slug (strip race-gender suffix)
  interface HelmetGroup {
    baseStem: string;
    variants: Map<string, { stemLower: string; m2Entry: { mpq: any; path: string } }>;
  }

  const groups = new Map<string, HelmetGroup>();

  for (const [stemLower, m2Entry] of m2Index) {
    const lastUnder = stemLower.lastIndexOf('_');
    if (lastUnder < 0) continue;

    const suffix = stemLower.slice(lastUnder + 1);
    const raceGender = RACE_GENDER_SUFFIXES[suffix];
    if (!raceGender) continue;

    const baseStemLower = stemLower.slice(0, lastUnder);
    const baseSlug = baseStemLower.replace(/_/g, '-');

    let group = groups.get(baseSlug);
    if (!group) {
      group = { baseStem: baseStemLower, variants: new Map() };
      groups.set(baseSlug, group);
    }

    if (!group.variants.has(raceGender)) {
      group.variants.set(raceGender, { stemLower, m2Entry });
    }
  }

  console.log(`  ${groups.size} helmet base models`);

  let convertedGroups = 0, convertedVariants = 0, skippedGroups = 0, skippedVariants = 0;
  let missingBlp = 0, errors = 0;

  let convertedTextures = 0;

  for (const [baseSlug, group] of groups) {
    const slugDir = resolve(ROOT, 'public/items/head', baseSlug);

    // Convert all IDI texture variants
    const texNames = helmetBaseToTextures.get(group.baseStem);
    let anyTex = false;
    if (texNames) {
      for (const texName of texNames) {
        const ts = texSlug(texName);
        const texPath = resolve(slugDir, 'textures', `${ts}.tex`);
        if (existsSync(texPath)) { anyTex = true; continue; }
        const blpEntry = findBlpByName(texName, blpIndex);
        if (!blpEntry) continue;
        try {
          const blpData = readMpqFile(blpEntry.mpq, blpEntry.path);
          convertBlpToTex(blpData, texPath);
          convertedTextures++;
          anyTex = true;
        } catch (err: any) {
          errors++;
          if (errors <= 5) console.error(`  TEX ERROR: ${baseSlug}/${ts} — ${err.message}`);
        }
      }
    }

    // Fallback: prefix BLP match
    if (!anyTex) {
      const fb = findBlpFallback(group.baseStem, blpIndex);
      if (fb) {
        const ts = texSlug(fb.blpStem);
        const texPath = resolve(slugDir, 'textures', `${ts}.tex`);
        if (!existsSync(texPath)) {
          try {
            const blpData = readMpqFile(fb.mpq, fb.path);
            convertBlpToTex(blpData, texPath);
            convertedTextures++;
            anyTex = true;
          } catch (err: any) {
            errors++;
            if (errors <= 5) console.error(`  FB TEX ERROR: ${baseSlug}/${ts} — ${err.message}`);
          }
        } else { anyTex = true; }
      }
    }

    if (!anyTex) { missingBlp++; continue; }

    let anyNew = false;
    for (const [rg, variant] of group.variants) {
      const variantDir = resolve(slugDir, rg);
      const variantJson = resolve(variantDir, 'model.json');

      if (existsSync(variantJson)) { skippedVariants++; continue; }

      try {
        const m2Data = readMpqFile(variant.m2Entry.mpq, variant.m2Entry.path);
        convertM2ToModelFiles(m2Data, variantDir);
        convertedVariants++;
        anyNew = true;
      } catch (err: any) {
        errors++;
        if (errors <= 5) console.error(`  M2 ERROR: ${baseSlug}/${rg} — ${err.message}`);
      }
    }

    if (anyNew) convertedGroups++;
    else skippedGroups++;
  }

  console.log(`  Groups: ${convertedGroups} new, ${skippedGroups} skipped (of ${groups.size})`);
  console.log(`  Variants: ${convertedVariants} new, ${skippedVariants} skipped. Textures: ${convertedTextures} new`);
  console.log(`  Missing BLP: ${missingBlp}, Errors: ${errors}`);
  return { convertedGroups, convertedVariants, convertedTextures, skippedGroups, skippedVariants, missingBlp, errors };
}

// ─── Process Shoulders ──────────────────────────────────────────────────────

function processShoulders() {
  console.log('\n=== Shoulders ===');
  const m2Index = buildIndex('Shoulder', 'm2');
  const blpIndex = buildIndex('Shoulder', 'blp');
  console.log(`  Found ${m2Index.size} unique M2s, ${blpIndex.size} unique BLPs in MPQs`);

  // Group by base slug (strip L/RShoulder_ prefix)
  interface ShoulderGroup {
    baseName: string;
    leftEntry?: { mpq: any; path: string };
    rightEntry?: { mpq: any; path: string };
  }

  const groups = new Map<string, ShoulderGroup>();

  for (const [stemLower, m2Entry] of m2Index) {
    let side: 'left' | 'right';
    let baseName: string;

    if (stemLower.startsWith('lshoulder_')) {
      side = 'left';
      baseName = stemLower.slice('lshoulder_'.length);
    } else if (stemLower.startsWith('rshoulder_')) {
      side = 'right';
      baseName = stemLower.slice('rshoulder_'.length);
    } else {
      continue;
    }

    const baseSlug = baseName.replace(/_/g, '-');

    let group = groups.get(baseSlug);
    if (!group) {
      group = { baseName };
      groups.set(baseSlug, group);
    }

    if (side === 'left' && !group.leftEntry) group.leftEntry = m2Entry;
    if (side === 'right' && !group.rightEntry) group.rightEntry = m2Entry;
  }

  console.log(`  ${groups.size} shoulder base models`);

  let convertedModels = 0, skippedModels = 0, convertedTextures = 0, missingBlp = 0, errors = 0;
  let leftCount = 0, rightCount = 0;

  for (const [baseSlug, group] of groups) {
    if (!group.leftEntry) continue; // Must have at least L model

    const slugDir = resolve(ROOT, 'public/items/shoulder', baseSlug);
    const leftJson = resolve(slugDir, 'left', 'model.json');

    const modelExists = existsSync(leftJson);

    // Convert all IDI texture variants
    const texNames = shoulderBaseToTextures.get(group.baseName);
    let anyTex = false;
    if (texNames) {
      for (const texName of texNames) {
        const ts = texSlug(texName);
        const texPath = resolve(slugDir, 'textures', `${ts}.tex`);
        if (existsSync(texPath)) { anyTex = true; continue; }
        const blpEntry = findBlpByName(texName, blpIndex);
        if (!blpEntry) continue;
        try {
          const blpData = readMpqFile(blpEntry.mpq, blpEntry.path);
          convertBlpToTex(blpData, texPath);
          convertedTextures++;
          anyTex = true;
        } catch (err: any) {
          errors++;
          if (errors <= 5) console.error(`  TEX ERROR: ${baseSlug}/${ts} — ${err.message}`);
        }
      }
    }

    // Fallback: prefix BLP match for shoulders
    if (!anyTex) {
      const fb = findShoulderBlpFallback(group.baseName, blpIndex);
      if (fb) {
        const ts = texSlug(fb.blpStem);
        const texPath = resolve(slugDir, 'textures', `${ts}.tex`);
        if (!existsSync(texPath)) {
          try {
            const blpData = readMpqFile(fb.mpq, fb.path);
            convertBlpToTex(blpData, texPath);
            convertedTextures++;
            anyTex = true;
          } catch (err: any) {
            errors++;
            if (errors <= 5) console.error(`  FB TEX ERROR: ${baseSlug}/${ts} — ${err.message}`);
          }
        } else { anyTex = true; }
      }
    }

    if (!anyTex) { missingBlp++; continue; }

    if (modelExists) { skippedModels++; continue; }

    // Convert L model
    try {
      const m2Data = readMpqFile(group.leftEntry.mpq, group.leftEntry.path);
      convertM2ToModelFiles(m2Data, resolve(slugDir, 'left'));
      leftCount++;
    } catch (err: any) {
      errors++;
      if (errors <= 5) console.error(`  L ERROR: ${baseSlug} — ${err.message}`);
      continue;
    }

    // Convert R model if available
    if (group.rightEntry) {
      try {
        const m2Data = readMpqFile(group.rightEntry.mpq, group.rightEntry.path);
        convertM2ToModelFiles(m2Data, resolve(slugDir, 'right'));
        rightCount++;
      } catch (err: any) {
        errors++;
        if (errors <= 5) console.error(`  R ERROR: ${baseSlug} — ${err.message}`);
      }
    }

    convertedModels++;
  }

  console.log(`  Models: ${convertedModels} new, ${skippedModels} skipped (of ${groups.size}). Textures: ${convertedTextures} new`);
  console.log(`  Left: ${leftCount}, Right: ${rightCount}`);
  console.log(`  Missing BLP: ${missingBlp}, Errors: ${errors}`);
  return { convertedModels, skippedModels, convertedTextures, leftCount, rightCount, missingBlp, errors };
}

// ─── Main ───────────────────────────────────────────────────────────────────

const wStats = processWeapons();
const sStats = processShields();
const hStats = processHelmets();
const shStats = processShoulders();

// Close MPQs
for (const { mpq } of mpqs) mpq.close();

console.log('\n=== Grand Total ===');
console.log(`Weapons:   ${wStats.convertedModels} models, ${wStats.convertedTextures} textures new, ${wStats.skippedModels} skipped, ${wStats.missingBlp} no BLP, ${wStats.errors} errors`);
console.log(`Shields:   ${sStats.convertedModels} models, ${sStats.convertedTextures} textures new, ${sStats.skippedModels} skipped, ${sStats.missingBlp} no BLP, ${sStats.errors} errors`);
console.log(`Helmets:   ${hStats.convertedGroups} groups (${hStats.convertedVariants} variants), ${hStats.convertedTextures} textures new, ${hStats.skippedGroups} skipped, ${hStats.missingBlp} no BLP, ${hStats.errors} errors`);
console.log(`Shoulders: ${shStats.convertedModels} models (L:${shStats.leftCount} R:${shStats.rightCount}), ${shStats.convertedTextures} textures new, ${shStats.skippedModels} skipped, ${shStats.missingBlp} no BLP, ${shStats.errors} errors`);

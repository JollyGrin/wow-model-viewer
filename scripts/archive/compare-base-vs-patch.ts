/**
 * Extract base HumanMale.M2 from model.MPQ and compare with patch-6 version.
 * Diagnostic script — not part of the build pipeline.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const { FS, MPQ } = await import('@wowserhq/stormjs');

const ROOT = resolve(import.meta.dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');
const EXTRACT_DIR = resolve(DATA_DIR, 'extracted');

FS.mkdir('/stormjs');
FS.mount(FS.filesystems.NODEFS, { root: DATA_DIR }, '/stormjs');

interface M2Summary {
  size: number;
  vertexCount: number;
  triCount: number;
  submeshCount: number;
  meshIds: Map<number, number>;
  submeshes: Array<{ id: number; vStart: number; vCount: number; iStart: number; iCount: number }>;
}

function parseM2Summary(buf: Buffer): M2Summary {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = buf.toString('ascii', 0, 4);
  const version = view.getUint32(4, true);
  if (magic !== 'MD20' || version !== 256) throw new Error(`Bad M2: magic=${magic} ver=${version}`);

  let off = 8;
  off += 8; // name
  off += 4; // globalFlags
  off += 8; // globalSequences
  off += 8; // animations
  off += 8; // animationLookup
  off += 8; // playableAnimLookup (v256 extra)
  off += 8; // bones
  off += 8; // keyBoneLookup
  const vertexCount = view.getUint32(off, true); off += 8;
  const viewOfs = view.getUint32(off + 4, true); off += 8;

  const remapCount = view.getUint32(viewOfs, true);
  const triCount = view.getUint32(viewOfs + 8, true);
  const submeshCount = view.getUint32(viewOfs + 24, true);
  const submeshOfs = view.getUint32(viewOfs + 28, true);

  const meshIds = new Map<number, number>();
  const submeshes: M2Summary['submeshes'] = [];
  for (let s = 0; s < submeshCount; s++) {
    const so = submeshOfs + s * 32;
    const id = view.getUint16(so, true);
    const vStart = view.getUint16(so + 4, true);
    const vCount = view.getUint16(so + 6, true);
    const iStart = view.getUint16(so + 8, true);
    const iCount = view.getUint16(so + 10, true);
    meshIds.set(id, (meshIds.get(id) || 0) + iCount);
    submeshes.push({ id, vStart, vCount, iStart, iCount });
  }

  return { size: buf.length, vertexCount, triCount, submeshCount, meshIds, submeshes };
}

function printSummary(label: string, s: M2Summary) {
  console.log(`\n=== ${label} ===`);
  console.log(`File size: ${s.size} bytes`);
  console.log(`Vertices: ${s.vertexCount}`);
  console.log(`Triangles: ${s.triCount} indices (${s.triCount / 3} tris)`);
  console.log(`Submeshes: ${s.submeshCount}`);
  console.log('\nMesh IDs (indices/tris):');
  for (const [id, count] of [...s.meshIds.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  id=${String(id).padStart(5)}: ${String(count).padStart(5)} idx (${String(count / 3).padStart(5)} tris)`);
  }
}

// --- Extract base M2 from model.MPQ ---
console.log('Opening model.MPQ...');
const modelMpq = await MPQ.open('/stormjs/model/model.MPQ', 'r');

// Search for all Human Male files
console.log('\nSearching model.MPQ for Human Male M2 files...');
try {
  const results = modelMpq.search('Character\\Human\\Male\\HumanMale*');
  console.log(`Found ${results.length} files:`);
  for (const r of results) {
    console.log(`  ${r.fileName} (${r.fileSize} bytes)`);
  }
} catch (err: any) {
  console.log(`Search failed: ${err.message}`);
}

// Extract the base M2
const M2_PATHS = [
  'Character\\Human\\Male\\HumanMale.m2',
  'Character\\Human\\Male\\HumanMale.M2',
];

let baseExtracted = false;
const baseOutPath = resolve(EXTRACT_DIR, 'Character/Human/Male/HumanMale.m2');

for (const path of M2_PATHS) {
  if (modelMpq.hasFile(path)) {
    console.log(`\nExtracting ${path}...`);
    const file = modelMpq.openFile(path);
    const data = file.read();
    file.close();
    mkdirSync(resolve(baseOutPath, '..'), { recursive: true });
    writeFileSync(baseOutPath, data);
    console.log(`  Extracted: ${data.length} bytes`);
    baseExtracted = true;
    break;
  }
}

modelMpq.close();

if (!baseExtracted) {
  console.error('ERROR: Could not find HumanMale.m2 in model.MPQ!');
  process.exit(1);
}

// --- Parse and compare ---
const baseBuf = readFileSync(baseOutPath);
const patchBuf = readFileSync(resolve(ROOT, 'data/patch/patch-6/Character/Human/Male/HumanMale.m2'));

const baseSummary = parseM2Summary(baseBuf);
const patchSummary = parseM2Summary(patchBuf);

printSummary('BASE (model.MPQ)', baseSummary);
printSummary('PATCH-6', patchSummary);

// --- Diff ---
console.log('\n\n=== COMPARISON ===');
console.log(`File size:  base=${baseSummary.size}  patch=${patchSummary.size}  diff=${patchSummary.size - baseSummary.size}`);
console.log(`Vertices:   base=${baseSummary.vertexCount}  patch=${patchSummary.vertexCount}  diff=${patchSummary.vertexCount - baseSummary.vertexCount}`);
console.log(`Triangles:  base=${baseSummary.triCount / 3}  patch=${patchSummary.triCount / 3}  diff=${(patchSummary.triCount - baseSummary.triCount) / 3}`);
console.log(`Submeshes:  base=${baseSummary.submeshCount}  patch=${patchSummary.submeshCount}  diff=${patchSummary.submeshCount - baseSummary.submeshCount}`);

// Compare mesh IDs
const allIds = new Set([...baseSummary.meshIds.keys(), ...patchSummary.meshIds.keys()]);
console.log('\nMesh ID comparison (tris):');
for (const id of [...allIds].sort((a, b) => a - b)) {
  const baseT = (baseSummary.meshIds.get(id) || 0) / 3;
  const patchT = (patchSummary.meshIds.get(id) || 0) / 3;
  const marker = baseT !== patchT ? ' <<<' : '';
  const onlyIn = !baseSummary.meshIds.has(id) ? ' [PATCH ONLY]' : !patchSummary.meshIds.has(id) ? ' [BASE ONLY]' : '';
  console.log(`  id=${String(id).padStart(5)}: base=${String(baseT).padStart(5)}  patch=${String(patchT).padStart(5)}  diff=${String(patchT - baseT).padStart(5)}${marker}${onlyIn}`);
}

// Check if files are identical
if (baseBuf.equals(patchBuf)) {
  console.log('\nFiles are IDENTICAL.');
} else {
  console.log(`\nFiles DIFFER.`);
  // Find first difference
  for (let i = 0; i < Math.min(baseBuf.length, patchBuf.length); i++) {
    if (baseBuf[i] !== patchBuf[i]) {
      console.log(`First byte difference at offset ${i} (0x${i.toString(16)}): base=0x${baseBuf[i].toString(16)} patch=0x${patchBuf[i].toString(16)}`);
      break;
    }
  }
}

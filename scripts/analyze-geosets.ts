/**
 * Analyze each geoset's spatial coverage to understand which body area it covers.
 * Prints min/max Y (height) and Z (depth) for each geoset to identify what fills gaps.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const BIN = resolve(ROOT, 'public/models/human-male.bin');
const JSON_PATH = resolve(ROOT, 'public/models/human-male.json');

const manifest = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
const bin = readFileSync(BIN);
const vertexView = new DataView(bin.buffer, bin.byteOffset, manifest.vertexBufferSize);
const indexView = new DataView(bin.buffer, bin.byteOffset + manifest.vertexBufferSize, manifest.indexBufferSize);

// WoW coords: X=right, Y=forward, Z=up
// In our output, each vertex is 6 floats: px, py, pz, nx, ny, nz

function analyzeGroup(g: { id: number; indexStart: number; indexCount: number }) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < g.indexCount; i++) {
    const vIdx = indexView.getUint16((g.indexStart + i) * 2, true);
    const x = vertexView.getFloat32(vIdx * 24 + 0, true);
    const y = vertexView.getFloat32(vIdx * 24 + 4, true);
    const z = vertexView.getFloat32(vIdx * 24 + 8, true);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }

  return { minX, maxX, minY, maxY, minZ, maxZ };
}

// Body height reference (Z-up): feet ~0, head ~2
console.log('Geoset spatial analysis (WoW coords: Z=up, Y=forward)');
console.log('ID     | Tris | Z range (height)       | Description guess');
console.log('-------|------|------------------------|------------------');

for (const g of manifest.groups) {
  const b = analyzeGroup(g);
  const tris = g.indexCount / 3;
  const zRange = `${b.minZ.toFixed(2)} - ${b.maxZ.toFixed(2)}`;

  let desc = '';
  const group = Math.floor(g.id / 100);
  if (g.id < 100) {
    // Check if it's upper body (Z > 1), lower body (Z < 1), or head (Z > 1.5)
    if (b.minZ > 1.4) desc = 'HEAD area';
    else if (b.maxZ < 0.8) desc = 'LOWER LEGS/FEET';
    else if (b.maxZ < 1.2) desc = 'UPPER LEGS';
    else desc = 'TORSO/ARMS';
  } else {
    const names: Record<number, string> = {
      1: 'Facial1', 2: 'Facial2', 3: 'Facial3',
      4: 'Gloves', 5: 'Boots', 7: 'Ears', 8: 'Sleeves',
      9: 'Kneepads', 10: 'Undershirt', 11: 'Pants', 12: 'Tabard',
      13: 'Robe/Kilt', 15: 'Cape',
    };
    desc = `${names[group] || 'Unknown'} (var ${g.id % 100})`;
  }

  console.log(`${String(g.id).padEnd(6)} | ${String(tris).padStart(4)} | ${zRange.padEnd(22)} | ${desc}`);
}

// Now show which currently-missing geosets cover the gap areas
console.log('\n=== Gap analysis ===');
console.log('Currently shown: body (0-13) + 401 + 501 + 701');
console.log('\nGeosets covering UPPER LEGS (Z ~0.5-1.0):');
for (const g of manifest.groups) {
  if (g.id >= 100) {
    const b = analyzeGroup(g);
    if (b.minZ < 1.0 && b.maxZ > 0.5 && b.minZ > 0.0) {
      console.log(`  id=${g.id}: Z=${b.minZ.toFixed(2)}-${b.maxZ.toFixed(2)} (${g.indexCount/3} tris)`);
    }
  }
}

console.log('\nGeosets covering HEAD/FACE (Z > 1.5):');
for (const g of manifest.groups) {
  if (g.id >= 100) {
    const b = analyzeGroup(g);
    if (b.maxZ > 1.5) {
      console.log(`  id=${g.id}: Z=${b.minZ.toFixed(2)}-${b.maxZ.toFixed(2)} (${g.indexCount/3} tris)`);
    }
  }
}

console.log('\nGeosets covering UPPER BACK/SHOULDERS (Z ~1.2-1.6):');
for (const g of manifest.groups) {
  if (g.id >= 100) {
    const b = analyzeGroup(g);
    if (b.minZ > 1.0 && b.maxZ < 1.8 && b.maxZ > 1.2) {
      console.log(`  id=${g.id}: Z=${b.minZ.toFixed(2)}-${b.maxZ.toFixed(2)} (${g.indexCount/3} tris)`);
    }
  }
}

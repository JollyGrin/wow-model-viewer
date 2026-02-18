/**
 * Diagnose geoset coverage: find exactly which Z ranges have triangle coverage
 * for each geoset, and identify holes in the body mesh.
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

// Get vertex position
function getVertex(idx: number): [number, number, number] {
  const off = idx * 24; // 6 floats * 4 bytes
  return [
    vertexView.getFloat32(off, true),
    vertexView.getFloat32(off + 4, true),
    vertexView.getFloat32(off + 8, true),
  ];
}

// Analyze triangle Z coverage per geoset with binning
function analyzeZCoverage(g: { id: number; indexStart: number; indexCount: number }) {
  const BIN_COUNT = 20;
  const bins = new Array(BIN_COUNT).fill(0); // triangle count per Z bin (0.0 to 2.0)

  for (let i = 0; i < g.indexCount; i += 3) {
    const i0 = indexView.getUint16((g.indexStart + i) * 2, true);
    const i1 = indexView.getUint16((g.indexStart + i + 1) * 2, true);
    const i2 = indexView.getUint16((g.indexStart + i + 2) * 2, true);
    const [, , z0] = getVertex(i0);
    const [, , z1] = getVertex(i1);
    const [, , z2] = getVertex(i2);
    const avgZ = (z0 + z1 + z2) / 3;
    const bin = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor(avgZ / 2.0 * BIN_COUNT)));
    bins[bin]++;
  }

  return bins;
}

// 1. Show body mesh (id=0) Z coverage
console.log('=== Body Mesh (id=0) Triangle Coverage by Z Height ===');
console.log('(Z is WoW up axis, ~0=feet, ~2=head top)');
console.log('');
const bodyGroup = manifest.groups.find((g: any) => g.id === 0);
if (bodyGroup) {
  const bins = analyzeZCoverage(bodyGroup);
  for (let i = 0; i < bins.length; i++) {
    const zLow = (i / bins.length * 2.0).toFixed(2);
    const zHigh = ((i + 1) / bins.length * 2.0).toFixed(2);
    const bar = '█'.repeat(Math.min(50, bins[i]));
    const marker = bins[i] === 0 ? ' *** HOLE ***' : '';
    console.log(`  Z ${zLow}-${zHigh}: ${String(bins[i]).padStart(4)} tris ${bar}${marker}`);
  }
}

// 2. Show currently enabled geosets coverage combined
console.log('\n=== Combined Coverage with DEFAULT_GEOSETS ===');
const DEFAULT_GEOSETS = new Set([0, 1, 101, 201, 301, 401, 501, 701, 903, 1002, 1102]);
const combinedBins = new Array(20).fill(0);
for (const g of manifest.groups) {
  if (DEFAULT_GEOSETS.has(g.id)) {
    const bins = analyzeZCoverage(g);
    for (let i = 0; i < bins.length; i++) combinedBins[i] += bins[i];
  }
}
for (let i = 0; i < combinedBins.length; i++) {
  const zLow = (i / 20 * 2.0).toFixed(2);
  const zHigh = ((i + 1) / 20 * 2.0).toFixed(2);
  const bar = '█'.repeat(Math.min(50, combinedBins[i]));
  const marker = combinedBins[i] === 0 ? ' *** HOLE ***' : '';
  console.log(`  Z ${zLow}-${zHigh}: ${String(combinedBins[i]).padStart(4)} tris ${bar}${marker}`);
}

// 3. For each hole in body mesh, show which geosets could fill it
console.log('\n=== Geoset Coverage for EACH Z Range ===');
for (let zBin = 0; zBin < 20; zBin++) {
  const zLow = zBin / 20 * 2.0;
  const zHigh = (zBin + 1) / 20 * 2.0;

  const coverages: { id: number; tris: number }[] = [];
  for (const g of manifest.groups) {
    const bins = analyzeZCoverage(g);
    if (bins[zBin] > 0) {
      coverages.push({ id: g.id, tris: bins[zBin] });
    }
  }

  if (coverages.length > 0) {
    console.log(`  Z ${zLow.toFixed(2)}-${zHigh.toFixed(2)}: ${coverages.map(c => `${c.id}(${c.tris})`).join(', ')}`);
  } else {
    console.log(`  Z ${zLow.toFixed(2)}-${zHigh.toFixed(2)}: NOTHING`);
  }
}

// 4. Count total tris per enabled set
console.log('\n=== Triangle counts per enabled geoset ===');
let totalTris = 0;
for (const g of manifest.groups) {
  if (DEFAULT_GEOSETS.has(g.id)) {
    const tris = g.indexCount / 3;
    totalTris += tris;
    console.log(`  id=${g.id}: ${tris} tris`);
  }
}
console.log(`  TOTAL: ${totalTris} tris`);

// 5. Try with ALL non-equipment geosets to see what fills gaps
console.log('\n=== What if we enable ALL geosets? ===');
const allBins = new Array(20).fill(0);
for (const g of manifest.groups) {
  const bins = analyzeZCoverage(g);
  for (let i = 0; i < bins.length; i++) allBins[i] += bins[i];
}
for (let i = 0; i < allBins.length; i++) {
  const zLow = (i / 20 * 2.0).toFixed(2);
  const zHigh = ((i + 1) / 20 * 2.0).toFixed(2);
  const bar = '█'.repeat(Math.min(50, allBins[i]));
  const marker = allBins[i] === 0 ? ' *** HOLE ***' : '';
  console.log(`  Z ${zLow}-${zHigh}: ${String(allBins[i]).padStart(4)} tris ${bar}${marker}`);
}

/**
 * Analyze back-of-head coverage for each hair geoset.
 * Measures how many triangles cover the back (negative X in M2 coords)
 * and the Z/Y extent of each hairstyle.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const m2Path = resolve(ROOT, 'data/patch/patch-6/Character/Human/Male/HumanMale.m2');
const buf = readFileSync(m2Path);
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// Parse M2 v256 header
let off = 8;
off += 8; off += 4; off += 8; off += 8; off += 8; off += 8; off += 8; off += 8;
const vertCount = view.getUint32(off, true);
const vertOfs = view.getUint32(off + 4, true);
off += 8;
const viewOfs = view.getUint32(off + 4, true);

// Parse vertices (48 bytes each)
function getVert(i: number) {
  const o = vertOfs + i * 48;
  return {
    x: view.getFloat32(o, true),
    y: view.getFloat32(o + 4, true),
    z: view.getFloat32(o + 8, true),
  };
}

// Parse view 0
const remapCount = view.getUint32(viewOfs, true);
const remapOfs = view.getUint32(viewOfs + 4, true);
const triCount = view.getUint32(viewOfs + 8, true);
const triOfs = view.getUint32(viewOfs + 12, true);
const submeshCount = view.getUint32(viewOfs + 24, true);
const submeshOfs = view.getUint32(viewOfs + 28, true);

// Read remap
const remap = new Uint16Array(remapCount);
for (let i = 0; i < remapCount; i++) {
  remap[i] = view.getUint16(remapOfs + i * 2, true);
}

// Read triangle indices
const tris = new Uint16Array(triCount);
for (let i = 0; i < triCount; i++) {
  tris[i] = view.getUint16(triOfs + i * 2, true);
}

// Parse submeshes
interface Submesh { id: number; iStart: number; iCount: number; vStart: number; vCount: number; }
const submeshes: Submesh[] = [];
for (let s = 0; s < submeshCount; s++) {
  const so = submeshOfs + s * 32;
  submeshes.push({
    id: view.getUint16(so, true),
    vStart: view.getUint16(so + 4, true),
    vCount: view.getUint16(so + 6, true),
    iStart: view.getUint16(so + 8, true),
    iCount: view.getUint16(so + 10, true),
  });
}

// Analyze each hair geoset (group 0, ids 0-18)
console.log('=== HAIR GEOSET BACK-OF-HEAD COVERAGE ===\n');
console.log('In M2 coords: X is front(+)/back(-), Y is left/right, Z is up\n');

// Also analyze body mesh (geoset 0) for reference
for (const targetId of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
  const subs = submeshes.filter(s => s.id === targetId);
  if (subs.length === 0) continue;

  let totalTris = 0;
  let backTris = 0;
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  let backXMin = Infinity, backZMin = Infinity, backZMax = -Infinity;
  let backYMin = Infinity, backYMax = -Infinity;

  for (const sub of subs) {
    for (let t = sub.iStart; t < sub.iStart + sub.iCount; t += 3) {
      const v0 = getVert(remap[tris[t]]);
      const v1 = getVert(remap[tris[t + 1]]);
      const v2 = getVert(remap[tris[t + 2]]);

      const cx = (v0.x + v1.x + v2.x) / 3;
      const cy = (v0.y + v1.y + v2.y) / 3;
      const cz = (v0.z + v1.z + v2.z) / 3;

      totalTris++;
      xMin = Math.min(xMin, v0.x, v1.x, v2.x);
      xMax = Math.max(xMax, v0.x, v1.x, v2.x);
      yMin = Math.min(yMin, v0.y, v1.y, v2.y);
      yMax = Math.max(yMax, v0.y, v1.y, v2.y);
      zMin = Math.min(zMin, v0.z, v1.z, v2.z);
      zMax = Math.max(zMax, v0.z, v1.z, v2.z);

      // "Back" = negative X (behind the head center)
      if (cx < 0) {
        backTris++;
        backXMin = Math.min(backXMin, cx);
        backZMin = Math.min(backZMin, cz);
        backZMax = Math.max(backZMax, cz);
        backYMin = Math.min(backYMin, cy);
        backYMax = Math.max(backYMax, cy);
      }
    }
  }

  const label = targetId === 0 ? 'BODY' : `hair ${targetId}`;
  console.log(`Geoset ${String(targetId).padStart(2)} (${label}): ${totalTris} tris, ${backTris} back tris (${Math.round(backTris/totalTris*100)}%)`);
  console.log(`  Full extent:  X[${xMin.toFixed(3)}, ${xMax.toFixed(3)}] Y[${yMin.toFixed(3)}, ${yMax.toFixed(3)}] Z[${zMin.toFixed(3)}, ${zMax.toFixed(3)}]`);
  if (backTris > 0) {
    console.log(`  Back extent:  X min=${backXMin.toFixed(3)}, Z[${backZMin.toFixed(3)}, ${backZMax.toFixed(3)}], Y[${backYMin.toFixed(3)}, ${backYMax.toFixed(3)}]`);
  }
  console.log();
}

// Now analyze the body mesh gap region specifically
console.log('\n=== BODY MESH GAP ANALYSIS ===\n');
const bodySubs = submeshes.filter(s => s.id === 0);
let headBackVerts = 0;
let neckVerts = 0;
let upperBackVerts = 0;

for (const sub of bodySubs) {
  for (let v = sub.vStart; v < sub.vStart + sub.vCount; v++) {
    const vert = getVert(remap[v]);
    if (vert.z > 1.2 && vert.x < 0) {
      if (vert.z > 1.6) headBackVerts++;
      else if (vert.z > 1.3) neckVerts++;
      else upperBackVerts++;
    }
  }
}

console.log(`Body mesh back vertices (X < 0):`);
console.log(`  Head back (Z > 1.6): ${headBackVerts}`);
console.log(`  Neck (Z 1.3-1.6):    ${neckVerts}`);
console.log(`  Upper back (Z 1.2-1.3): ${upperBackVerts}`);

// Find boundary edges in neck/head region
console.log('\n=== BODY MESH BOUNDARY EDGES (Z > 1.2, X < 0) ===\n');
const edgeMap = new Map<string, number>();
for (const sub of bodySubs) {
  for (let t = sub.iStart; t < sub.iStart + sub.iCount; t += 3) {
    const i0 = remap[tris[t]], i1 = remap[tris[t+1]], i2 = remap[tris[t+2]];
    const edges = [[i0,i1],[i1,i2],[i2,i0]];
    for (const [a,b] of edges) {
      const key = `${Math.min(a,b)}-${Math.max(a,b)}`;
      edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
    }
  }
}
let boundaryCount = 0;
const boundaryVerts = new Set<number>();
for (const [key, count] of edgeMap) {
  if (count === 1) {
    const [a, b] = key.split('-').map(Number);
    const va = getVert(a), vb = getVert(b);
    if ((va.z > 1.2 && va.x < -0.05) || (vb.z > 1.2 && vb.x < -0.05)) {
      boundaryCount++;
      boundaryVerts.add(a);
      boundaryVerts.add(b);
    }
  }
}
console.log(`Boundary edges at back of head: ${boundaryCount}`);
console.log(`Boundary vertices: ${boundaryVerts.size}`);

// Print the boundary vertex positions
const sortedBoundary = [...boundaryVerts].map(i => ({ i, ...getVert(i) })).sort((a,b) => a.z - b.z);
console.log('\nBoundary vertices (sorted by Z):');
for (const v of sortedBoundary) {
  console.log(`  v${v.i}: X=${v.x.toFixed(3)} Y=${v.y.toFixed(3)} Z=${v.z.toFixed(3)}`);
}

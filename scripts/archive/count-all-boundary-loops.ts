/**
 * Count and characterize ALL boundary loops in the body mesh (geoset 0).
 * This tells us exactly how many "holes" exist in the body mesh.
 *
 * Also check: when hair geoset 5 is combined with body, do any loops close?
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MODEL_DIR = path.resolve(ROOT, 'public/models/human-male');

interface Group {
  id: number;
  indexStart: number;
  indexCount: number;
  textureType: number;
}

interface Manifest {
  vertexCount: number;
  indexCount: number;
  vertexBufferSize: number;
  indexBufferSize: number;
  vertexStride: number;
  groups: Group[];
}

const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, 'model.json'), 'utf-8'));
const bin = fs.readFileSync(path.join(MODEL_DIR, 'model.bin'));

const STRIDE = manifest.vertexStride;
const STRIDE_F32 = STRIDE / 4;

const vbuf = new Float32Array(
  bin.buffer.slice(bin.byteOffset, bin.byteOffset + manifest.vertexBufferSize)
);
const ibuf = new Uint16Array(
  bin.buffer.slice(
    bin.byteOffset + manifest.vertexBufferSize,
    bin.byteOffset + manifest.vertexBufferSize + manifest.indexBufferSize
  )
);

function getPos(vi: number): [number, number, number] {
  const f = vi * STRIDE_F32;
  return [vbuf[f], vbuf[f + 1], vbuf[f + 2]];
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function findBoundaryLoops(groupIds: number[]): { loops: number[][]; totalBoundaryEdges: number } {
  const edges = new Map<string, number>();
  for (const g of manifest.groups) {
    if (!groupIds.includes(g.id)) continue;
    for (let i = 0; i < g.indexCount; i += 3) {
      const a = ibuf[g.indexStart + i];
      const b = ibuf[g.indexStart + i + 1];
      const c = ibuf[g.indexStart + i + 2];
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const key = edgeKey(p, q);
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
  }

  // Boundary edges
  const adj = new Map<number, Set<number>>();
  let boundaryCount = 0;
  for (const [key, count] of edges) {
    if (count !== 1) continue;
    boundaryCount++;
    const [a, b] = key.split('-').map(Number);
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }

  // Trace loops
  const visited = new Set<number>();
  const loops: number[][] = [];

  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [start];
    visited.add(start);
    let current = start;
    while (true) {
      const neighbors = adj.get(current)!;
      let next: number | null = null;
      for (const n of neighbors) {
        if (!visited.has(n)) {
          next = n;
          break;
        }
      }
      if (next === null) break;
      loop.push(next);
      visited.add(next);
      current = next;
    }
    loops.push(loop);
  }

  return { loops, totalBoundaryEdges: boundaryCount };
}

function describeLoop(loop: number[]): string {
  let zMin = Infinity, zMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let xMin = Infinity, xMax = -Infinity;
  for (const vi of loop) {
    const [x, y, z] = getPos(vi);
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }

  let region = '';
  if (zMax > 1.8) region = 'HEAD/CROWN';
  else if (zMax > 1.5) region = 'NECK/SHOULDER';
  else if (zMax > 1.0) region = 'TORSO/ARM';
  else if (zMax > 0.5) region = 'WAIST/THIGH';
  else region = 'FOOT/GROUND';

  return `${loop.length} verts  Z[${zMin.toFixed(2)}..${zMax.toFixed(2)}]  Y[${yMin.toFixed(2)}..${yMax.toFixed(2)}]  X[${xMin.toFixed(2)}..${xMax.toFixed(2)}]  [${region}]`;
}

// ============================================================
// Body mesh only
// ============================================================

console.log('='.repeat(80));
console.log('BODY MESH (geoset 0) — ALL BOUNDARY LOOPS');
console.log('='.repeat(80));
console.log('');

const bodyResult = findBoundaryLoops([0]);
console.log(`Total boundary edges: ${bodyResult.totalBoundaryEdges}`);
console.log(`Total loops: ${bodyResult.loops.length}`);
console.log('');

bodyResult.loops
  .sort((a, b) => b.length - a.length)
  .forEach((loop, i) => {
    console.log(`  Loop ${i}: ${describeLoop(loop)}`);
  });

// ============================================================
// Body + Hair geoset 5
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('BODY + HAIR (geosets 0+5) — ALL BOUNDARY LOOPS');
console.log('='.repeat(80));
console.log('');

const bodyHairResult = findBoundaryLoops([0, 5]);
console.log(`Total boundary edges: ${bodyHairResult.totalBoundaryEdges}`);
console.log(`Total loops: ${bodyHairResult.loops.length}`);
console.log('');

bodyHairResult.loops
  .sort((a, b) => b.length - a.length)
  .forEach((loop, i) => {
    console.log(`  Loop ${i}: ${describeLoop(loop)}`);
  });

// ============================================================
// ALL active geosets
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('ALL ACTIVE GEOSETS — ALL BOUNDARY LOOPS');
console.log('='.repeat(80));
console.log('');

const allResult = findBoundaryLoops([0, 5, 101, 201, 301, 401, 501, 701, 1301]);
console.log(`Total boundary edges: ${allResult.totalBoundaryEdges}`);
console.log(`Total loops: ${allResult.loops.length}`);
console.log('');

allResult.loops
  .sort((a, b) => b.length - a.length)
  .forEach((loop, i) => {
    console.log(`  Loop ${i}: ${describeLoop(loop)}`);
  });

// ============================================================
// Summary: which loops are in the HEAD region (potential gap)
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('HEAD REGION LOOPS (Z > 1.5) — THESE ARE THE VISIBLE GAPS');
console.log('='.repeat(80));
console.log('');

console.log('Body only:');
const bodyHeadLoops = bodyResult.loops.filter(l => {
  const maxZ = Math.max(...l.map(vi => getPos(vi)[2]));
  return maxZ > 1.5;
});
bodyHeadLoops.sort((a, b) => b.length - a.length);
for (const loop of bodyHeadLoops) {
  console.log(`  ${describeLoop(loop)}`);
}

console.log(`\nBody + Hair:`)
const bhHeadLoops = bodyHairResult.loops.filter(l => {
  const maxZ = Math.max(...l.map(vi => getPos(vi)[2]));
  return maxZ > 1.5;
});
bhHeadLoops.sort((a, b) => b.length - a.length);
for (const loop of bhHeadLoops) {
  console.log(`  ${describeLoop(loop)}`);
}

console.log(`\nAll active:`)
const allHeadLoops = allResult.loops.filter(l => {
  const maxZ = Math.max(...l.map(vi => getPos(vi)[2]));
  return maxZ > 1.5;
});
allHeadLoops.sort((a, b) => b.length - a.length);
for (const loop of allHeadLoops) {
  console.log(`  ${describeLoop(loop)}`);
}

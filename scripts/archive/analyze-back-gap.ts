/**
 * Focused analysis: what EXACTLY is the gap at the back of the head?
 *
 * Compares the combined active geometry to find:
 * 1. The exact boundary loop at the back of the head
 * 2. Whether hair geoset 5 actually covers the back or just the sides
 * 3. The spatial gap between body mesh and hair mesh
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

function getNormal(vi: number): [number, number, number] {
  const f = vi * STRIDE_F32;
  return [vbuf[f + 3], vbuf[f + 4], vbuf[f + 5]];
}

// ============================================================
// Analysis 1: Which hair geosets are actually hairstyles?
// ============================================================

console.log('='.repeat(80));
console.log('HAIR GEOSET VARIANTS IN GROUP 0');
console.log('In WoW, group 0 contains the body (variant 0) + hair meshes (variants 1-18+)');
console.log('='.repeat(80));
console.log('');

// Group 0 geosets — understand the structure
// From the WoW client, CharHairGeosets.dbc maps:
//   raceId + genderId + hairstyleId → geosetId (the group 0 variant)
//
// So geoset 0 = body, geoset 1-18 = different hairstyles
// The currently active geoset 5 = hairstyle #5

// Body mesh boundary: where does it end at the top of the head?
const bodySubmeshes = manifest.groups.filter(g => g.id === 0);
console.log('Body mesh (id=0) vertex analysis:');

let bodyTopVerts: { vi: number; x: number; y: number; z: number; ny: number }[] = [];
const bodySeen = new Set<number>();

for (const sub of bodySubmeshes) {
  for (let i = 0; i < sub.indexCount; i++) {
    const vi = ibuf[sub.indexStart + i];
    if (bodySeen.has(vi)) continue;
    bodySeen.add(vi);
    const [x, y, z] = getPos(vi);
    if (z > 1.7) { // upper head area
      const [nx, ny, nz] = getNormal(vi);
      bodyTopVerts.push({ vi, x, y, z, ny });
    }
  }
}

bodyTopVerts.sort((a, b) => b.z - a.z);
console.log(`  Vertices above Z=1.7: ${bodyTopVerts.length}`);
console.log('  Top 30 vertices (sorted by Z desc):');
for (const v of bodyTopVerts.slice(0, 30)) {
  const dir = v.ny < -0.3 ? 'BACK' : v.ny > 0.3 ? 'FRONT' : 'SIDE';
  console.log(
    `    v${v.vi}: (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}) ny=${v.ny.toFixed(2)} [${dir}]`
  );
}

// ============================================================
// Analysis 2: Hair geoset 5 coverage specifically
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('HAIR GEOSET 5 — DETAILED SPATIAL ANALYSIS');
console.log('='.repeat(80));
console.log('');

const hair5Subs = manifest.groups.filter(g => g.id === 5);

for (let si = 0; si < hair5Subs.length; si++) {
  const g = hair5Subs[si];
  const allVerts: { vi: number; x: number; y: number; z: number; nx: number; ny: number; nz: number }[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < g.indexCount; i++) {
    const vi = ibuf[g.indexStart + i];
    if (seen.has(vi)) continue;
    seen.add(vi);
    const [x, y, z] = getPos(vi);
    const [nx, ny, nz] = getNormal(vi);
    allVerts.push({ vi, x, y, z, nx, ny, nz });
  }

  console.log(`Submesh #${si} (idxStart=${g.indexStart}, tris=${g.indexCount/3}, tex=${g.textureType}):`);
  console.log(`  Total unique verts: ${allVerts.length}`);

  // Sort by Y to understand front-to-back distribution
  allVerts.sort((a, b) => a.y - b.y);
  const minY = allVerts[0].y;
  const maxY = allVerts[allVerts.length - 1].y;
  const midY = (minY + maxY) / 2;

  console.log(`  Y range: ${minY.toFixed(3)} to ${maxY.toFixed(3)} (midpoint: ${midY.toFixed(3)})`);

  // Count verts by quadrant
  let backLeft = 0, backRight = 0, frontLeft = 0, frontRight = 0;
  for (const v of allVerts) {
    const isBack = v.y < 0;
    const isLeft = v.x < 0;
    if (isBack && isLeft) backLeft++;
    else if (isBack && !isLeft) backRight++;
    else if (!isBack && isLeft) frontLeft++;
    else frontRight++;
  }
  console.log(`  Quadrants: backLeft=${backLeft}, backRight=${backRight}, frontLeft=${frontLeft}, frontRight=${frontRight}`);

  // Show the BACK vertices (Y < 0)
  const backVerts = allVerts.filter(v => v.y < -0.05);
  console.log(`\n  BACK vertices (Y < -0.05): ${backVerts.length}`);
  backVerts.sort((a, b) => b.z - a.z);
  for (const v of backVerts.slice(0, 30)) {
    console.log(
      `    v${v.vi}: (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})  n=(${v.nx.toFixed(2)}, ${v.ny.toFixed(2)}, ${v.nz.toFixed(2)})`
    );
  }
}

// ============================================================
// Analysis 3: Body mesh back-of-head boundary — exact hole shape
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('BODY MESH BACK-OF-HEAD HOLE — EXACT SHAPE');
console.log('='.repeat(80));
console.log('');

// Build edge map for body mesh only
function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

const bodyEdges = new Map<string, number>();
for (const sub of bodySubmeshes) {
  for (let i = 0; i < sub.indexCount; i += 3) {
    const a = ibuf[sub.indexStart + i];
    const b = ibuf[sub.indexStart + i + 1];
    const c = ibuf[sub.indexStart + i + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(p, q);
      bodyEdges.set(key, (bodyEdges.get(key) ?? 0) + 1);
    }
  }
}

// Find boundary edges in upper head (Z > 1.7)
const upperBoundary: { a: number; b: number }[] = [];
for (const [key, count] of bodyEdges) {
  if (count !== 1) continue;
  const [a, b] = key.split('-').map(Number);
  const [ax, ay, az] = getPos(a);
  const [bx, by, bz] = getPos(b);
  if (az > 1.7 || bz > 1.7) {
    upperBoundary.push({ a, b });
  }
}

// Build adjacency for upper boundary
const adj = new Map<number, number[]>();
for (const e of upperBoundary) {
  if (!adj.has(e.a)) adj.set(e.a, []);
  if (!adj.has(e.b)) adj.set(e.b, []);
  adj.get(e.a)!.push(e.b);
  adj.get(e.b)!.push(e.a);
}

// Trace the MAIN loop (largest connected component)
const visited = new Set<number>();
const components: number[][] = [];

for (const start of adj.keys()) {
  if (visited.has(start)) continue;
  const comp: number[] = [];
  const stack = [start];
  while (stack.length > 0) {
    const v = stack.pop()!;
    if (visited.has(v)) continue;
    visited.add(v);
    comp.push(v);
    for (const n of adj.get(v) ?? []) {
      if (!visited.has(n)) stack.push(n);
    }
  }
  components.push(comp);
}

components.sort((a, b) => b.length - a.length);
console.log(`Upper head boundary components: ${components.length}`);
for (let ci = 0; ci < components.length; ci++) {
  const comp = components[ci];
  let zMin = Infinity, zMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let backCount = 0;

  for (const vi of comp) {
    const [x, y, z] = getPos(vi);
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
    if (y < -0.02) backCount++;
  }

  console.log(
    `  Component ${ci}: ${comp.length} verts, Z[${zMin.toFixed(2)}..${zMax.toFixed(2)}], ` +
    `Y[${yMin.toFixed(2)}..${yMax.toFixed(2)}], ${backCount} back-facing`
  );
}

// Print the main loop (largest component)
if (components.length > 0) {
  const mainLoop = components[0];
  console.log(`\nMain boundary loop (${mainLoop.length} verts), ordered by angle from center:`);

  // Sort by angle around centroid
  let cx = 0, cz = 0;
  for (const vi of mainLoop) {
    const [x, y, z] = getPos(vi);
    cx += x;
    cz += z;
  }
  cx /= mainLoop.length;
  cz /= mainLoop.length;

  const withAngle = mainLoop.map(vi => {
    const [x, y, z] = getPos(vi);
    const angle = Math.atan2(z - cz, x - cx);
    return { vi, x, y, z, angle };
  });
  withAngle.sort((a, b) => a.angle - b.angle);

  // Split into back (Y<0) and front (Y>0)
  const backVerts = withAngle.filter(v => v.y < -0.02);
  const frontVerts = withAngle.filter(v => v.y >= -0.02);

  console.log(`\n  BACK vertices (Y < -0.02) — these define the visible gap:`);
  backVerts.sort((a, b) => b.z - a.z);
  for (const v of backVerts) {
    const [nx, ny, nz] = getNormal(v.vi);
    console.log(
      `    v${v.vi}: (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}) n=(${nx.toFixed(2)}, ${ny.toFixed(2)}, ${nz.toFixed(2)})`
    );
  }

  console.log(`\n  FRONT/CENTER vertices (Y >= -0.02):`);
  frontVerts.sort((a, b) => b.z - a.z);
  for (const v of frontVerts) {
    console.log(
      `    v${v.vi}: (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`
    );
  }
}

// ============================================================
// Analysis 4: Does hair geoset 5 share vertices with body mesh boundary?
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('DO HAIR AND BODY SHARE BOUNDARY VERTICES?');
console.log('='.repeat(80));
console.log('');

const bodyBoundaryVerts = new Set<number>();
for (const [key, count] of bodyEdges) {
  if (count !== 1) continue;
  const [a, b] = key.split('-').map(Number);
  bodyBoundaryVerts.add(a);
  bodyBoundaryVerts.add(b);
}

const hairVerts = new Set<number>();
for (const g of manifest.groups.filter(g => g.id === 5)) {
  for (let i = 0; i < g.indexCount; i++) {
    hairVerts.add(ibuf[g.indexStart + i]);
  }
}

const shared = [...bodyBoundaryVerts].filter(v => hairVerts.has(v));
console.log(`Body boundary vertices: ${bodyBoundaryVerts.size}`);
console.log(`Hair geoset 5 vertices: ${hairVerts.size}`);
console.log(`Shared vertices: ${shared.length}`);

if (shared.length > 0) {
  console.log('Shared vertices:');
  for (const vi of shared.sort((a, b) => a - b)) {
    const [x, y, z] = getPos(vi);
    console.log(`  v${vi}: (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})`);
  }
}

// Check ALL body vertices vs hair vertices
const bodyAllVerts = new Set<number>();
for (const sub of bodySubmeshes) {
  for (let i = 0; i < sub.indexCount; i++) {
    bodyAllVerts.add(ibuf[sub.indexStart + i]);
  }
}

const allShared = [...bodyAllVerts].filter(v => hairVerts.has(v));
console.log(`\nAll body verts: ${bodyAllVerts.size}`);
console.log(`All body-hair shared verts: ${allShared.length}`);
if (allShared.length > 0) {
  console.log('Shared body-hair vertices (first 20):');
  for (const vi of allShared.sort((a, b) => a - b).slice(0, 20)) {
    const [x, y, z] = getPos(vi);
    console.log(`  v${vi}: (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})`);
  }
}

// ============================================================
// Analysis 5: What would it look like to enable ALL group 0 geosets?
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('NOTE ON GEOSET VISIBILITY LOGIC');
console.log('='.repeat(80));
console.log('');
console.log('WoW geoset visibility rules for group 0 (body/hair):');
console.log('  - ID 0 = body mesh (ALWAYS active)');
console.log('  - ID 1-18 = different HAIRSTYLES (mutually exclusive)');
console.log('  - CharHairGeosets.dbc maps (race, gender, hairstyleIndex) -> geosetId');
console.log('  - Only ONE hairstyle geoset should be active at a time');
console.log('  - Some hairstyles have TWO submeshes (one with tex=-1/hair, one with tex=1/skin)');
console.log('');
console.log('The body mesh (id=0) has an INTENTIONAL hole at the top of the head.');
console.log('The hair geoset is supposed to cover this hole.');
console.log('');
console.log('However, the hair geoset may not cover the back of the head/neck.');
console.log('In WoW, this is covered by the SCALP TEXTURE composited onto the head region.');
console.log('The body mesh vertex UVs in that region map to a scalp/hair texture that');
console.log('provides visual continuity.');
console.log('');
console.log('KEY FINDING: The gap is NOT about missing geometry.');
console.log('It is about the body mesh being open at the crown, which the hair geoset');
console.log('is supposed to cap. The BACK of the head has body mesh geometry but the');
console.log('scalp texture (composited hair color) makes it look continuous.');

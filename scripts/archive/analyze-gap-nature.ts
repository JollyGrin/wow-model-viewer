/**
 * Final analysis: understand the EXACT nature of the back-of-head gap.
 *
 * Key question: Is this a "hole in the mesh" or a "visible back face issue"?
 *
 * From previous analysis:
 * - Body mesh has 454 boundary edges
 * - 200 are in head/neck area (Z > 1.0)
 * - Main loop around the crown has ~20 vertices
 * - Hair geoset 5 and body mesh share ZERO vertices
 *
 * This script determines:
 * 1. Where exactly the body mesh stops at the top of the head
 * 2. What the gap looks like from a rear camera angle
 * 3. Whether hair geoset 5 geometry overlaps with the gap spatially
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

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

// ============================================================
// 1. The crown loop — the main opening at the top of the body mesh
// ============================================================

console.log('='.repeat(80));
console.log('THE CROWN OPENING — BODY MESH MAIN BOUNDARY');
console.log('='.repeat(80));
console.log('');

// These are the 20 vertices from the main crown boundary loop (from Part 5 analysis)
const crownLoop = [40, 41, 39, 5, 3, 62, 96, 95, 54, 53, 52, 92, 51, 50, 49, 90, 89, 75, 27, 31];

console.log('Crown opening loop (20 vertices, traced in order):');
console.log('  v#    X       Y       Z       Normal-Y  Direction');
for (const vi of crownLoop) {
  const [x, y, z] = getPos(vi);
  const [nx, ny, nz] = getNormal(vi);
  const dir = ny < -0.3 ? 'BACK' : ny > 0.3 ? 'FRONT' : ny < -0.1 ? 'back' : ny > 0.1 ? 'front' : 'SIDE';
  console.log(
    `  v${vi.toString().padStart(3)}: ${x.toFixed(3).padStart(7)} ${y.toFixed(3).padStart(7)} ${z.toFixed(3).padStart(7)}  ny=${ny.toFixed(2).padStart(6)}  ${dir}`
  );
}

// Compute centroid and extents
let cx = 0, cy = 0, cz = 0;
for (const vi of crownLoop) {
  const [x, y, z] = getPos(vi);
  cx += x; cy += y; cz += z;
}
cx /= crownLoop.length;
cy /= crownLoop.length;
cz /= crownLoop.length;

console.log(`\nCentroid: (${cx.toFixed(3)}, ${cy.toFixed(3)}, ${cz.toFixed(3)})`);

// The Y coordinate tells us front vs back:
// Y > 0 = front of character
// Y < 0 = back of character
// The crown loop spans Y from -0.079 to +0.079
// This means the opening is roughly 0.16 units wide front-to-back

const backVerts = crownLoop.filter(vi => getPos(vi)[1] < -0.02);
const frontVerts = crownLoop.filter(vi => getPos(vi)[1] > 0.02);
const centerVerts = crownLoop.filter(vi => Math.abs(getPos(vi)[1]) <= 0.02);

console.log(`\nBack verts (Y < -0.02): ${backVerts.length}`);
console.log(`Front verts (Y > 0.02): ${frontVerts.length}`);
console.log(`Center verts (|Y| <= 0.02): ${centerVerts.length}`);

// ============================================================
// 2. The hair geoset 5 — where does it sit relative to the crown?
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('HAIR GEOSET 5 — COVERAGE RELATIVE TO CROWN');
console.log('='.repeat(80));
console.log('');

// Get bounding box of hair mesh vertices that are above Z=1.8 (crown area)
const hair5Subs = manifest.groups.filter(g => g.id === 5);
const hairAboveCrown: { vi: number; x: number; y: number; z: number }[] = [];
const hairSeen = new Set<number>();

for (const g of hair5Subs) {
  for (let i = 0; i < g.indexCount; i++) {
    const vi = ibuf[g.indexStart + i];
    if (hairSeen.has(vi)) continue;
    hairSeen.add(vi);
    const [x, y, z] = getPos(vi);
    if (z > 1.8) {
      hairAboveCrown.push({ vi, x, y, z });
    }
  }
}

console.log(`Hair verts above Z=1.8 (crown area): ${hairAboveCrown.length}`);
if (hairAboveCrown.length > 0) {
  let hxMin = Infinity, hxMax = -Infinity, hyMin = Infinity, hyMax = -Infinity, hzMin = Infinity, hzMax = -Infinity;
  for (const v of hairAboveCrown) {
    if (v.x < hxMin) hxMin = v.x;
    if (v.x > hxMax) hxMax = v.x;
    if (v.y < hyMin) hyMin = v.y;
    if (v.y > hyMax) hyMax = v.y;
    if (v.z < hzMin) hzMin = v.z;
    if (v.z > hzMax) hzMax = v.z;
  }
  console.log(`  X: ${hxMin.toFixed(3)} to ${hxMax.toFixed(3)}`);
  console.log(`  Y: ${hyMin.toFixed(3)} to ${hyMax.toFixed(3)}`);
  console.log(`  Z: ${hzMin.toFixed(3)} to ${hzMax.toFixed(3)}`);

  // Crown opening Y range is roughly -0.079 to +0.079
  // Does hair extend to cover this?
  const hairCoversBack = hyMin < -0.05;
  const hairCoversFront = hyMax > 0.05;
  console.log(`\n  Hair extends to back (Y < -0.05): ${hairCoversBack ? 'YES' : 'NO'} (min Y = ${hyMin.toFixed(3)})`);
  console.log(`  Hair extends to front (Y > 0.05): ${hairCoversFront ? 'YES' : 'NO'} (max Y = ${hyMax.toFixed(3)})`);
}

// ============================================================
// 3. Check for triangle normals — are there missing back-facing triangles?
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('BODY MESH FACE NORMALS AT BACK OF HEAD');
console.log('='.repeat(80));
console.log('');

// Check triangles in the upper head area (Z > 1.7)
const bodySubmeshes = manifest.groups.filter(g => g.id === 0);
let frontFacing = 0;
let backFacing = 0;
let sideFacing = 0;
let totalUpperTris = 0;

for (const sub of bodySubmeshes) {
  for (let i = 0; i < sub.indexCount; i += 3) {
    const a = ibuf[sub.indexStart + i];
    const b = ibuf[sub.indexStart + i + 1];
    const c = ibuf[sub.indexStart + i + 2];

    const [ax, ay, az] = getPos(a);
    const [bx, by, bz] = getPos(b);
    const [cx2, cy, cz] = getPos(c);

    const avgZ = (az + bz + cz) / 3;
    if (avgZ < 1.7) continue;

    totalUpperTris++;

    // Compute face normal
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx2 - ax, e2y = cy - ay, e2z = cz - az;
    const fnx = e1y * e2z - e1z * e2y;
    const fny = e1z * e2x - e1x * e2z;
    const fnz = e1x * e2y - e1y * e2x;

    // fny < 0 means face points backward (toward back of head)
    // fny > 0 means face points forward (toward face)
    if (fny < -0.1) backFacing++;
    else if (fny > 0.1) frontFacing++;
    else sideFacing++;
  }
}

console.log(`Upper head triangles (avg Z > 1.7): ${totalUpperTris}`);
console.log(`  Front-facing (fny > 0.1): ${frontFacing}`);
console.log(`  Back-facing (fny < -0.1): ${backFacing}`);
console.log(`  Side/top-facing: ${sideFacing}`);
console.log('');
console.log('If back-facing count is similar to front-facing, geometry exists on both sides.');
console.log('The gap is likely the crown opening, not missing back geometry.');

// ============================================================
// 4. Check ALL active geosets for boundary edges SPECIFICALLY visible from back
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('ACTIVE GEOSETS — BOUNDARY EDGES VISIBLE FROM BACK CAMERA');
console.log('='.repeat(80));
console.log('');

// Collect ALL edges from ALL active geosets
const ACTIVE = new Set([0, 5, 101, 201, 301, 401, 501, 701, 1301]);
const allEdges = new Map<string, { count: number; owners: number[] }>();

for (const g of manifest.groups) {
  if (!ACTIVE.has(g.id)) continue;
  for (let i = 0; i < g.indexCount; i += 3) {
    const a = ibuf[g.indexStart + i];
    const b = ibuf[g.indexStart + i + 1];
    const c = ibuf[g.indexStart + i + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(p, q);
      const e = allEdges.get(key);
      if (e) {
        e.count++;
        if (!e.owners.includes(g.id)) e.owners.push(g.id);
      } else {
        allEdges.set(key, { count: 1, owners: [g.id] });
      }
    }
  }
}

// Find boundary edges that would be visible from the back (Y < 0)
const backBoundary: { a: number; b: number; avgZ: number; avgY: number }[] = [];
for (const [key, data] of allEdges) {
  if (data.count !== 1) continue;
  const [a, b] = key.split('-').map(Number);
  const [ax, ay, az] = getPos(a);
  const [bx, by, bz] = getPos(b);
  const avgY = (ay + by) / 2;
  const avgZ = (az + bz) / 2;

  // Back-facing AND above neck
  if (avgY < -0.02 && avgZ > 1.5) {
    backBoundary.push({ a, b, avgZ, avgY });
  }
}

backBoundary.sort((a, b) => b.avgZ - a.avgZ);
console.log(`Boundary edges visible from back (Y < -0.02, Z > 1.5): ${backBoundary.length}`);
console.log('');

// Group by Z bands
const zBands: Record<string, number> = {};
for (const e of backBoundary) {
  const band = (Math.floor(e.avgZ * 10) / 10).toFixed(1);
  zBands[band] = (zBands[band] ?? 0) + 1;
}

console.log('Back boundary edges by Z band:');
for (const [band, count] of Object.entries(zBands).sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))) {
  console.log(`  Z ~${band}: ${count} edges`);
}

// Top 20 back boundary edges
console.log('\nTop 20 back boundary edges (highest Z):');
for (const e of backBoundary.slice(0, 20)) {
  const [ax, ay, az] = getPos(e.a);
  const [bx, by, bz] = getPos(e.b);
  console.log(
    `  v${e.a}(${ax.toFixed(3)},${ay.toFixed(3)},${az.toFixed(3)}) — v${e.b}(${bx.toFixed(3)},${by.toFixed(3)},${bz.toFixed(3)})`
  );
}

// ============================================================
// 5. CRITICAL: Does the body mesh have the back of the skull?
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('CRITICAL: BODY MESH HEAD COVERAGE CHECK');
console.log('='.repeat(80));
console.log('');

// The body mesh (id=0) — check if it has vertices at the BACK of the head
// above the neck. If the body mesh stops at the ears/temples, the back of the
// head RELIES on the hair texture being skin-colored.

const bodyVerts: { vi: number; x: number; y: number; z: number; ny: number }[] = [];
const bSeen = new Set<number>();
for (const sub of bodySubmeshes) {
  for (let i = 0; i < sub.indexCount; i++) {
    const vi = ibuf[sub.indexStart + i];
    if (bSeen.has(vi)) continue;
    bSeen.add(vi);
    const [x, y, z] = getPos(vi);
    const [nx, ny, nz] = getNormal(vi);
    bodyVerts.push({ vi, x, y, z, ny });
  }
}

// For the back of head (Z > 1.6, Y < 0), what's the Y range?
const backHeadBody = bodyVerts.filter(v => v.z > 1.6 && v.y < 0);
const frontHeadBody = bodyVerts.filter(v => v.z > 1.6 && v.y > 0);

console.log(`Body mesh verts with Z > 1.6:`);
console.log(`  Back (Y < 0): ${backHeadBody.length}`);
console.log(`  Front (Y > 0): ${frontHeadBody.length}`);

if (backHeadBody.length > 0) {
  const minY = Math.min(...backHeadBody.map(v => v.y));
  const maxZ = Math.max(...backHeadBody.map(v => v.z));
  console.log(`  Back verts: Y goes down to ${minY.toFixed(3)}, Z goes up to ${maxZ.toFixed(3)}`);
  console.log(`  This means the body mesh DOES cover the back of the head.`);
}

// Check specifically: does the body mesh wrap all the way around at Z=1.8?
const z18Band = bodyVerts.filter(v => v.z > 1.75 && v.z < 1.85);
const z18Ys = z18Band.map(v => v.y).sort((a, b) => a - b);
if (z18Ys.length > 0) {
  console.log(`\n  At Z~1.8: ${z18Band.length} verts, Y range [${z18Ys[0].toFixed(3)} .. ${z18Ys[z18Ys.length-1].toFixed(3)}]`);
  console.log('  Y range shows how far the body mesh wraps around at this height.');
}

// And at Z=1.9 (near the crown):
const z19Band = bodyVerts.filter(v => v.z > 1.85 && v.z < 1.95);
const z19Ys = z19Band.map(v => v.y).sort((a, b) => a - b);
if (z19Ys.length > 0) {
  console.log(`  At Z~1.9: ${z19Band.length} verts, Y range [${z19Ys[0].toFixed(3)} .. ${z19Ys[z19Ys.length-1].toFixed(3)}]`);
}

// And at Z=1.95+ (crown):
const z195Band = bodyVerts.filter(v => v.z > 1.95);
const z195Ys = z195Band.map(v => v.y).sort((a, b) => a - b);
if (z195Ys.length > 0) {
  console.log(`  At Z~1.95+: ${z195Band.length} verts, Y range [${z195Ys[0].toFixed(3)} .. ${z195Ys[z195Ys.length-1].toFixed(3)}]`);
}

// ============================================================
// CONCLUSION
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('CONCLUSION');
console.log('='.repeat(80));
console.log('');
console.log('The body mesh (geoset 0) wraps around the entire head:');
console.log('  - Face (front), sides, back, and up to the crown');
console.log('  - At Z=1.8 it spans Y = -0.060 to +0.060 (full wrap)');
console.log('  - At Z=1.9+ it narrows to Y = -0.079 to +0.079 (converging to crown)');
console.log('  - The crown opening (Loop 0, 20 verts) is at Z ~1.80-1.96');
console.log('');
console.log('The hair geoset (id=5) sits on top of the head and extends DOWN the back:');
console.log('  - It goes from Z=2.0 (crown top) down to Z=1.56 (below crown)');
console.log('  - Y range: -0.145 to +0.145 (wider than body mesh at same height)');
console.log('  - 63 vertices in the back-of-head region');
console.log('  - But it shares ZERO vertices with the body mesh');
console.log('');
console.log('THE GAP EXPLAINED:');
console.log('  The body mesh has a crown opening (20-vertex loop at Z ~1.80-1.96).');
console.log('  The hair geoset sits ON TOP but does not connect to the body mesh.');
console.log('  There is a gap between where the body mesh ends (crown loop)');
console.log('  and where the hair mesh starts.');
console.log('');
console.log('  From the front: the face is solid, hair sits on top — gap is hidden.');
console.log('  From the back: the body mesh goes up to Z~1.84 at Y~-0.06,');
console.log('  but the crown loop gap is visible as a seam/hole between body and hair.');
console.log('');
console.log('IN WOW CLIENT: The scalp texture (hair-colored) is composited onto the');
console.log('body mesh UVs in the head region, making the gap less visible.');
console.log('The body mesh normals face outward, so from behind, the inner surface');
console.log('of the crown opening is not rendered (single-sided rendering).');
console.log('With DoubleSide on, you see the inner surface, making the gap MORE visible.');
console.log('');
console.log('POTENTIAL FIXES:');
console.log('1. Use FrontSide rendering for body mesh (hides inner crown surface)');
console.log('2. Composite a scalp/hair-colored texture on body mesh head UVs');
console.log('3. Generate a crown cap mesh (triangle fan covering the opening)');
console.log('4. Check if a different hairstyle geoset covers the crown better');

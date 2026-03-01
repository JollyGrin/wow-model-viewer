/**
 * Comprehensive M2 geoset analysis for human male.
 * Parses the raw M2 binary to list ALL submeshes/geosets,
 * compute bounding boxes, find boundary edges, and identify
 * any geometry that could cover the back/neck gap.
 *
 * Uses the already-converted model.json + model.bin for fast access.
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

const STRIDE = manifest.vertexStride; // 40
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

function getUV(vi: number): [number, number] {
  const f = vi * STRIDE_F32;
  return [vbuf[f + 6], vbuf[f + 7]];
}

// Currently active geosets
const ACTIVE = new Set([0, 5, 101, 201, 301, 401, 501, 701, 1301]);

function isActive(id: number): boolean {
  return ACTIVE.has(id);
}

// ============================================================
// PART 1: Full geoset inventory
// ============================================================

console.log('='.repeat(80));
console.log('PART 1: COMPLETE GEOSET INVENTORY');
console.log('='.repeat(80));
console.log('');

// Group by geoset group (id / 100)
interface GeosetInfo {
  id: number;
  group: number;
  variant: number;
  indexStart: number;
  indexCount: number;
  triangleCount: number;
  uniqueVerts: number;
  textureType: number;
  bbox: { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number };
  active: boolean;
  // Multiple submeshes can share the same id
  submeshIndex: number;
}

const geosetInfos: GeosetInfo[] = [];

for (let si = 0; si < manifest.groups.length; si++) {
  const g = manifest.groups[si];
  const verts = new Set<number>();
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;

  for (let i = 0; i < g.indexCount; i++) {
    const vi = ibuf[g.indexStart + i];
    verts.add(vi);
    const [x, y, z] = getPos(vi);
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }

  geosetInfos.push({
    id: g.id,
    group: Math.floor(g.id / 100),
    variant: g.id % 100,
    indexStart: g.indexStart,
    indexCount: g.indexCount,
    triangleCount: g.indexCount / 3,
    uniqueVerts: verts.size,
    textureType: g.textureType,
    bbox: { xMin, xMax, yMin, yMax, zMin, zMax },
    active: isActive(g.id),
    submeshIndex: si,
  });
}

// Print grouped by geoset group
const byGroup = new Map<number, GeosetInfo[]>();
for (const info of geosetInfos) {
  if (!byGroup.has(info.group)) byGroup.set(info.group, []);
  byGroup.get(info.group)!.push(info);
}

// WoW geoset group names
const GROUP_NAMES: Record<number, string> = {
  0: 'Body/Hair',
  1: 'Facial 1 (mustache)',
  2: 'Facial 2 (beard)',
  3: 'Facial 3 (sideburns)',
  4: 'Gloves',
  5: 'Boots/Feet',
  7: 'Ears',
  8: 'Sleeves/Wristbands',
  9: 'Kneepads/Legs lower',
  10: 'Tabard/Chest',
  11: 'Legs upper',
  12: 'Tabard lower/Belt buckle',
  13: 'Trousers/Robe',
  15: 'Cape/Cloak',
};

for (const [grp, items] of [...byGroup.entries()].sort((a, b) => a[0] - b[0])) {
  const name = GROUP_NAMES[grp] ?? '???';
  console.log(`\nGroup ${grp} — ${name}`);
  console.log('-'.repeat(60));
  for (const info of items.sort((a, b) => a.id - b.id || a.submeshIndex - b.submeshIndex)) {
    const marker = info.active ? '  [ACTIVE]' : '';
    const texLabel = info.textureType >= 0 ? `tex=${info.textureType}` : 'tex=?';
    console.log(
      `  ID ${info.id.toString().padStart(5)} (sub#${info.submeshIndex.toString().padStart(2)}) ` +
      `${info.triangleCount.toString().padStart(4)} tris  ${info.uniqueVerts.toString().padStart(4)} verts  ` +
      `Z[${info.bbox.zMin.toFixed(2)}..${info.bbox.zMax.toFixed(2)}]  ` +
      `Y[${info.bbox.yMin.toFixed(2)}..${info.bbox.yMax.toFixed(2)}]  ` +
      `${texLabel}${marker}`
    );
  }
}

// ============================================================
// PART 2: Geosets NOT currently rendered
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('PART 2: GEOSETS NOT CURRENTLY RENDERED');
console.log('='.repeat(80));
console.log(`\nActive geosets: ${[...ACTIVE].sort((a,b)=>a-b).join(', ')}`);
console.log('');

// The isGeosetVisible logic: for a given geoset id, it checks if enabledGeosets contains that exact id
// AND both are in the same group (id/100).
// So group 0 has id=0 active, but also ids 5, 7, 8, 12, 6, 9, etc.
// Only id=0 and id=5 from group 0 are active.

const inactiveGeosets = geosetInfos.filter(info => !info.active);
const activeGeosets = geosetInfos.filter(info => info.active);

console.log('Inactive geosets that contain geometry above Z=1.0 (neck/head area):');
console.log('');

for (const info of inactiveGeosets) {
  if (info.bbox.zMax > 1.0) {
    console.log(
      `  ID ${info.id.toString().padStart(5)} (sub#${info.submeshIndex.toString().padStart(2)}) ` +
      `${info.triangleCount.toString().padStart(4)} tris  ` +
      `Z[${info.bbox.zMin.toFixed(2)}..${info.bbox.zMax.toFixed(2)}]  ` +
      `Y[${info.bbox.yMin.toFixed(2)}..${info.bbox.yMax.toFixed(2)}]`
    );
  }
}

// ============================================================
// PART 3: Body mesh (geoset 0) boundary edge analysis
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('PART 3: BODY MESH BOUNDARY EDGE ANALYSIS');
console.log('='.repeat(80));

// Collect all triangles for ACTIVE geosets
// Build edge map: edge(a,b) -> count of triangles using it

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

// Analyze just the body mesh geoset (id=0, first submesh)
const bodySubmeshes = manifest.groups.filter(g => g.id === 0);
console.log(`\nBody mesh (id=0) submeshes: ${bodySubmeshes.length}`);

// Collect all triangles from body mesh
const bodyEdgeCounts = new Map<string, number>();
const bodyEdgeTriangles = new Map<string, number[][]>();
let bodyTriCount = 0;

for (const sub of bodySubmeshes) {
  for (let i = 0; i < sub.indexCount; i += 3) {
    const a = ibuf[sub.indexStart + i];
    const b = ibuf[sub.indexStart + i + 1];
    const c = ibuf[sub.indexStart + i + 2];
    bodyTriCount++;

    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(p, q);
      bodyEdgeCounts.set(key, (bodyEdgeCounts.get(key) ?? 0) + 1);
      if (!bodyEdgeTriangles.has(key)) bodyEdgeTriangles.set(key, []);
      bodyEdgeTriangles.get(key)!.push([a, b, c]);
    }
  }
}

// Boundary edges: used by exactly 1 triangle
const boundaryEdges: { a: number; b: number; key: string }[] = [];
for (const [key, count] of bodyEdgeCounts) {
  if (count === 1) {
    const [a, b] = key.split('-').map(Number);
    boundaryEdges.push({ a, b, key });
  }
}

console.log(`Body mesh triangles: ${bodyTriCount}`);
console.log(`Total edges: ${bodyEdgeCounts.size}`);
console.log(`Boundary edges (1 triangle): ${boundaryEdges.length}`);
console.log('');

// Categorize boundary edges by Z height
const headNeckBoundary: typeof boundaryEdges = [];
const midBodyBoundary: typeof boundaryEdges = [];
const lowerBoundary: typeof boundaryEdges = [];

for (const edge of boundaryEdges) {
  const [ax, ay, az] = getPos(edge.a);
  const [bx, by, bz] = getPos(edge.b);
  const avgZ = (az + bz) / 2;

  if (avgZ > 1.0) {
    headNeckBoundary.push(edge);
  } else if (avgZ > 0.5) {
    midBodyBoundary.push(edge);
  } else {
    lowerBoundary.push(edge);
  }
}

console.log(`Boundary edges by height zone:`);
console.log(`  Head/Neck (Z > 1.0): ${headNeckBoundary.length}`);
console.log(`  Mid body (0.5 < Z < 1.0): ${midBodyBoundary.length}`);
console.log(`  Lower body (Z < 0.5): ${lowerBoundary.length}`);

// ============================================================
// PART 4: Head/Neck boundary edge details
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('PART 4: HEAD/NECK BOUNDARY EDGES IN DETAIL');
console.log('='.repeat(80));
console.log('');

// Sort head/neck boundary edges by Z, then Y
headNeckBoundary.sort((a, b) => {
  const za = (getPos(a.a)[2] + getPos(a.b)[2]) / 2;
  const zb = (getPos(b.a)[2] + getPos(b.b)[2]) / 2;
  return zb - za; // highest first
});

console.log('Head/Neck boundary edges (sorted by Z height, descending):');
console.log('  Edge vertices: position (x,y,z), normal direction, UV coords');
console.log('');

for (const edge of headNeckBoundary) {
  const [ax, ay, az] = getPos(edge.a);
  const [bx, by, bz] = getPos(edge.b);
  const [anx, any, anz] = getNormal(edge.a);
  const [bnx, bny, bnz] = getNormal(edge.b);
  const [au, av] = getUV(edge.a);
  const [bu, bv] = getUV(edge.b);

  // Is the normal pointing backward (negative Y)?
  const avgNy = (any + bny) / 2;
  const direction = avgNy < -0.3 ? 'BACK' : avgNy > 0.3 ? 'FRONT' : 'SIDE';

  console.log(
    `  v${edge.a}(${ax.toFixed(3)},${ay.toFixed(3)},${az.toFixed(3)}) — ` +
    `v${edge.b}(${bx.toFixed(3)},${by.toFixed(3)},${bz.toFixed(3)})  ` +
    `normal=[${direction}]  UV(${au.toFixed(3)},${av.toFixed(3)})-(${bu.toFixed(3)},${bv.toFixed(3)})`
  );
}

// ============================================================
// PART 5: Trace boundary loops in head/neck area
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('PART 5: BOUNDARY LOOPS IN HEAD/NECK AREA');
console.log('='.repeat(80));
console.log('');

// Build adjacency from boundary edges
const boundaryAdj = new Map<number, Set<number>>();
for (const edge of headNeckBoundary) {
  if (!boundaryAdj.has(edge.a)) boundaryAdj.set(edge.a, new Set());
  if (!boundaryAdj.has(edge.b)) boundaryAdj.set(edge.b, new Set());
  boundaryAdj.get(edge.a)!.add(edge.b);
  boundaryAdj.get(edge.b)!.add(edge.a);
}

// Trace loops
const visited = new Set<number>();
const loops: number[][] = [];

for (const startVert of boundaryAdj.keys()) {
  if (visited.has(startVert)) continue;

  const loop: number[] = [startVert];
  visited.add(startVert);
  let current = startVert;

  while (true) {
    const neighbors = boundaryAdj.get(current)!;
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

console.log(`Found ${loops.length} boundary loop(s) in head/neck area:`);
for (let li = 0; li < loops.length; li++) {
  const loop = loops[li];

  let lzMin = Infinity, lzMax = -Infinity;
  let lyMin = Infinity, lyMax = -Infinity;
  let lxMin = Infinity, lxMax = -Infinity;
  let backCount = 0;
  let frontCount = 0;
  let sideCount = 0;

  for (const vi of loop) {
    const [x, y, z] = getPos(vi);
    const [nx, ny, nz] = getNormal(vi);
    if (x < lxMin) lxMin = x;
    if (x > lxMax) lxMax = x;
    if (y < lyMin) lyMin = y;
    if (y > lyMax) lyMax = y;
    if (z < lzMin) lzMin = z;
    if (z > lzMax) lzMax = z;

    if (ny < -0.3) backCount++;
    else if (ny > 0.3) frontCount++;
    else sideCount++;
  }

  console.log(`\n  Loop ${li}: ${loop.length} vertices`);
  console.log(`    X: ${lxMin.toFixed(3)} to ${lxMax.toFixed(3)}`);
  console.log(`    Y: ${lyMin.toFixed(3)} to ${lyMax.toFixed(3)}`);
  console.log(`    Z: ${lzMin.toFixed(3)} to ${lzMax.toFixed(3)}`);
  console.log(`    Normal directions: ${backCount} BACK, ${frontCount} FRONT, ${sideCount} SIDE`);

  // Print the loop vertices with positions
  console.log(`    Vertices (in loop order):`);
  for (const vi of loop) {
    const [x, y, z] = getPos(vi);
    const [nx, ny, nz] = getNormal(vi);
    const dir = ny < -0.3 ? 'BACK' : ny > 0.3 ? 'FRONT' : 'SIDE';
    console.log(
      `      v${vi}: (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})  ` +
      `n=(${nx.toFixed(2)}, ${ny.toFixed(2)}, ${nz.toFixed(2)}) [${dir}]`
    );
  }
}

// ============================================================
// PART 6: ALL active geosets combined boundary analysis
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('PART 6: ALL ACTIVE GEOSETS COMBINED — BOUNDARY EDGES IN HEAD/NECK');
console.log('='.repeat(80));
console.log('');

// Build edge map for ALL active geosets
const allEdgeCounts = new Map<string, number>();
const allEdgeOwner = new Map<string, Set<number>>(); // which geoset(s) own this edge

for (const g of manifest.groups) {
  if (!isActive(g.id)) continue;

  for (let i = 0; i < g.indexCount; i += 3) {
    const a = ibuf[g.indexStart + i];
    const b = ibuf[g.indexStart + i + 1];
    const c = ibuf[g.indexStart + i + 2];

    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(p, q);
      allEdgeCounts.set(key, (allEdgeCounts.get(key) ?? 0) + 1);
      if (!allEdgeOwner.has(key)) allEdgeOwner.set(key, new Set());
      allEdgeOwner.get(key)!.add(g.id);
    }
  }
}

let allBoundaryInHead = 0;
let allBoundaryByDirection = { back: 0, front: 0, side: 0 };
const allBoundaryEdgesHead: { a: number; b: number; owners: Set<number> }[] = [];

for (const [key, count] of allEdgeCounts) {
  if (count !== 1) continue;
  const [a, b] = key.split('-').map(Number);
  const [ax, ay, az] = getPos(a);
  const [bx, by, bz] = getPos(b);
  const avgZ = (az + bz) / 2;

  if (avgZ > 1.0) {
    allBoundaryInHead++;
    const [anx, any, anz] = getNormal(a);
    const [bnx, bny, bnz] = getNormal(b);
    const avgNy = (any + bny) / 2;
    if (avgNy < -0.3) allBoundaryByDirection.back++;
    else if (avgNy > 0.3) allBoundaryByDirection.front++;
    else allBoundaryByDirection.side++;

    allBoundaryEdgesHead.push({ a, b, owners: allEdgeOwner.get(key)! });
  }
}

console.log(`All active geosets combined — boundary edges in head/neck (Z>1.0): ${allBoundaryInHead}`);
console.log(`  BACK-facing: ${allBoundaryByDirection.back}`);
console.log(`  FRONT-facing: ${allBoundaryByDirection.front}`);
console.log(`  SIDE-facing: ${allBoundaryByDirection.side}`);

// ============================================================
// PART 7: Check for geosets that spatially overlap the gap
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('PART 7: INACTIVE GEOSETS THAT COULD COVER THE HEAD/NECK GAP');
console.log('='.repeat(80));
console.log('');

// The gap is in the back of the head/neck: Y negative, Z > 1.0
// Check ALL inactive geosets for vertices in this region

for (const info of geosetInfos) {
  if (info.active) continue;

  const g = manifest.groups[info.submeshIndex];
  let backHeadVerts = 0;
  let totalVerts = 0;
  const vertsInRegion: { vi: number; x: number; y: number; z: number }[] = [];

  const seen = new Set<number>();
  for (let i = 0; i < g.indexCount; i++) {
    const vi = ibuf[g.indexStart + i];
    if (seen.has(vi)) continue;
    seen.add(vi);
    totalVerts++;

    const [x, y, z] = getPos(vi);
    // Back of head: Z > 1.0 AND Y < 0 (back side)
    if (z > 1.0 && y < 0) {
      backHeadVerts++;
      if (vertsInRegion.length < 10) { // sample up to 10
        vertsInRegion.push({ vi, x, y, z });
      }
    }
  }

  if (backHeadVerts > 0) {
    console.log(
      `  Geoset ${info.id} (sub#${info.submeshIndex}, group=${info.group}): ` +
      `${backHeadVerts}/${totalVerts} verts in back-of-head region  ` +
      `[Z ${info.bbox.zMin.toFixed(2)}..${info.bbox.zMax.toFixed(2)}, ` +
      `Y ${info.bbox.yMin.toFixed(2)}..${info.bbox.yMax.toFixed(2)}]`
    );
    for (const v of vertsInRegion) {
      console.log(`    v${v.vi}: (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`);
    }
  }
}

// ============================================================
// PART 8: Hair geosets analysis
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('PART 8: HAIR GEOSETS (GROUP 0 with high variant IDs) — POTENTIAL SCALP COVER');
console.log('='.repeat(80));
console.log('');

// In WoW, hair geosets are in group 0 with variant > 0.
// Some hair styles may cover the back of the head.
// The body mesh gap should be covered by the hair texture on the scalp area.

const hairGeosets = geosetInfos.filter(i => i.group === 0 && i.variant > 0);
console.log('All group-0 variant geosets (potential hair/scalp):');
for (const info of hairGeosets) {
  const g = manifest.groups[info.submeshIndex];

  // Check back coverage
  let backZ1Verts = 0;
  const seen = new Set<number>();
  for (let i = 0; i < g.indexCount; i++) {
    const vi = ibuf[g.indexStart + i];
    if (seen.has(vi)) continue;
    seen.add(vi);
    const [x, y, z] = getPos(vi);
    if (z > 1.0 && y < 0) backZ1Verts++;
  }

  const marker = info.active ? '  [ACTIVE]' : '';
  console.log(
    `  ID ${info.id.toString().padStart(3)} (sub#${info.submeshIndex.toString().padStart(2)}) ` +
    `${info.triangleCount.toString().padStart(4)} tris  ${info.uniqueVerts.toString().padStart(4)} verts  ` +
    `Z[${info.bbox.zMin.toFixed(2)}..${info.bbox.zMax.toFixed(2)}]  ` +
    `Y[${info.bbox.yMin.toFixed(2)}..${info.bbox.yMax.toFixed(2)}]  ` +
    `back-head-verts=${backZ1Verts}  ` +
    `tex=${info.textureType}${marker}`
  );
}

// ============================================================
// PART 9: Geoset 5 (active hair) — does it cover the back?
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('PART 9: GEOSET 5 (ACTIVE HAIRSTYLE) — BACK COVERAGE');
console.log('='.repeat(80));
console.log('');

// There are TWO submeshes with id=5
const geoset5Subs = manifest.groups.filter(g => g.id === 5);
console.log(`Submeshes with id=5: ${geoset5Subs.length}`);

for (let si = 0; si < geoset5Subs.length; si++) {
  const g = geoset5Subs[si];
  const seen = new Set<number>();
  let backVerts: { vi: number; x: number; y: number; z: number; ny: number }[] = [];

  for (let i = 0; i < g.indexCount; i++) {
    const vi = ibuf[g.indexStart + i];
    if (seen.has(vi)) continue;
    seen.add(vi);
    const [x, y, z] = getPos(vi);
    const [nx, ny, nz] = getNormal(vi);
    if (z > 1.0 && y < -0.1) {
      backVerts.push({ vi, x, y, z, ny });
    }
  }

  console.log(`\n  Submesh #${si} (indexStart=${g.indexStart}, ${g.indexCount} indices, tex=${g.textureType}):`);
  console.log(`    Total unique verts: ${seen.size}`);
  console.log(`    Verts in back-of-head (Z>1.0, Y<-0.1): ${backVerts.length}`);

  // Sort by Z descending
  backVerts.sort((a, b) => b.z - a.z);
  for (const v of backVerts.slice(0, 20)) {
    const dir = v.ny < -0.3 ? 'BACK' : v.ny > 0.3 ? 'FRONT' : 'SIDE';
    console.log(
      `      v${v.vi}: (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}) normal-Y=${v.ny.toFixed(2)} [${dir}]`
    );
  }
}

// ============================================================
// PART 10: Summary and recommendations
// ============================================================

console.log('\n');
console.log('='.repeat(80));
console.log('PART 10: SUMMARY');
console.log('='.repeat(80));
console.log('');

// Count total tris across all active geosets
let activeTris = 0;
let inactiveTris = 0;
for (const info of geosetInfos) {
  if (info.active) activeTris += info.triangleCount;
  else inactiveTris += info.triangleCount;
}

console.log(`Active geosets: ${activeGeosets.length} submeshes, ${activeTris} triangles`);
console.log(`Inactive geosets: ${inactiveGeosets.length} submeshes, ${inactiveTris} triangles`);
console.log(`Total: ${geosetInfos.length} submeshes`);
console.log('');

// Which inactive geosets are in same group as active ones?
console.log('Geoset conflicts (inactive geosets in same group as active ones):');
const activeGroups = new Set(activeGeosets.map(g => g.group));
for (const info of inactiveGeosets) {
  if (activeGroups.has(info.group)) {
    const activeInGroup = activeGeosets.filter(g => g.group === info.group).map(g => g.id);
    console.log(
      `  Inactive ${info.id} (sub#${info.submeshIndex}) conflicts with active [${activeInGroup.join(',')}] in group ${info.group}`
    );
  }
}

console.log('');
console.log('Geosets in groups with NO active member (completely unrendered groups):');
for (const info of inactiveGeosets) {
  if (!activeGroups.has(info.group)) {
    console.log(
      `  ID ${info.id} (group ${info.group}, sub#${info.submeshIndex}) — ${info.triangleCount} tris — ` +
      `Z[${info.bbox.zMin.toFixed(2)}..${info.bbox.zMax.toFixed(2)}]`
    );
  }
}

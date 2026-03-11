/**
 * waist-boundary.ts
 *
 * Extracts boundary vertices from the waist region of geoset 0 (body mesh)
 * and the top boundary of geoset 501 (upper legs).
 *
 * A "boundary edge" is an edge that belongs to only one triangle within the geoset.
 * A "boundary vertex" is a vertex that participates in at least one boundary edge.
 *
 * Usage: npx tsx scripts/waist-boundary.ts
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE = join(__dirname, "..", "public", "models");
const manifest = JSON.parse(readFileSync(join(BASE, "human-male.json"), "utf8"));
const binBuf = readFileSync(join(BASE, "human-male.bin"));

// Parse vertex buffer (8 floats per vertex: pos3, normal3, uv2)
const VERTEX_STRIDE = manifest.vertexStride; // 32 bytes = 8 floats
const vertexCount = manifest.vertexCount;
const vertexBuffer = new Float32Array(
  binBuf.buffer,
  binBuf.byteOffset,
  vertexCount * 8
);

// Parse index buffer (uint16, starts right after vertex buffer)
const indexOffset = manifest.vertexBufferSize;
const indexBuffer = new Uint16Array(
  binBuf.buffer,
  binBuf.byteOffset + indexOffset,
  manifest.indexCount
);

interface Vertex {
  index: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  u: number;
  v: number;
}

function getVertex(idx: number): Vertex {
  const off = idx * 8;
  return {
    index: idx,
    x: vertexBuffer[off + 0],
    y: vertexBuffer[off + 1],
    z: vertexBuffer[off + 2],
    nx: vertexBuffer[off + 3],
    ny: vertexBuffer[off + 4],
    nz: vertexBuffer[off + 5],
    u: vertexBuffer[off + 6],
    v: vertexBuffer[off + 7],
  };
}

/**
 * Find boundary vertex indices for a geoset group.
 * An edge is boundary if it appears in exactly one triangle within the geoset.
 */
function findBoundaryVertices(
  indexStart: number,
  indexCount: number
): Set<number> {
  const edgeCounts = new Map<string, number>();
  const edgeKey = (a: number, b: number) =>
    a < b ? `${a}-${b}` : `${b}-${a}`;

  for (let i = indexStart; i < indexStart + indexCount; i += 3) {
    const a = indexBuffer[i];
    const b = indexBuffer[i + 1];
    const c = indexBuffer[i + 2];

    for (const key of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) {
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
  }

  const boundaryVerts = new Set<number>();
  for (const [key, count] of edgeCounts) {
    if (count === 1) {
      const [a, b] = key.split("-").map(Number);
      boundaryVerts.add(a);
      boundaryVerts.add(b);
    }
  }

  return boundaryVerts;
}

/**
 * Filter boundary vertices by Z range and return full vertex data.
 */
function getBoundaryVertsInZRange(
  boundarySet: Set<number>,
  zMin: number,
  zMax: number
): Vertex[] {
  const result: Vertex[] = [];
  for (const idx of boundarySet) {
    const v = getVertex(idx);
    if (v.z >= zMin && v.z <= zMax) {
      result.push(v);
    }
  }
  return result;
}

function fmt(n: number): string {
  return n.toFixed(4);
}

function classify(y: number): string {
  if (y < -0.03) return "left";
  if (y > 0.03) return "right";
  return "center";
}

function printVertices(
  label: string,
  verts: Vertex[],
  sortByAngle: boolean = true
) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`${label} (${verts.length} vertices)`);
  console.log("=".repeat(80));

  if (verts.length === 0) {
    console.log("  (none)");
    return;
  }

  // Classify vertices
  const left = verts.filter((v) => classify(v.y) === "left");
  const right = verts.filter((v) => classify(v.y) === "right");
  const center = verts.filter((v) => classify(v.y) === "center");

  if (sortByAngle) {
    // Sort left by angle: atan2(X, -(Y - leftCentroidY))
    if (left.length > 0) {
      const leftCentroidY =
        left.reduce((sum, v) => sum + v.y, 0) / left.length;
      left.sort(
        (a, b) =>
          Math.atan2(a.x, -(a.y - leftCentroidY)) -
          Math.atan2(b.x, -(b.y - leftCentroidY))
      );
    }

    // Sort right by angle: atan2(X, (Y - rightCentroidY))
    if (right.length > 0) {
      const rightCentroidY =
        right.reduce((sum, v) => sum + v.y, 0) / right.length;
      right.sort(
        (a, b) =>
          Math.atan2(a.x, a.y - rightCentroidY) -
          Math.atan2(b.x, b.y - rightCentroidY)
      );
    }

    // Sort center by X
    center.sort((a, b) => a.x - b.x);
  }

  const printGroup = (groupLabel: string, group: Vertex[]) => {
    if (group.length === 0) return;
    console.log(`\n  --- ${groupLabel} (${group.length} vertices) ---`);
    console.log(
      `  ${"#".padStart(3)}  ${"VtxIdx".padStart(6)}  ${"X".padStart(8)} ${"Y".padStart(8)} ${"Z".padStart(8)}  |  ${"NX".padStart(8)} ${"NY".padStart(8)} ${"NZ".padStart(8)}  |  ${"U".padStart(8)} ${"V".padStart(8)}`
    );
    console.log(`  ${"─".repeat(96)}`);
    group.forEach((v, i) => {
      console.log(
        `  ${(i + 1).toString().padStart(3)}  ${v.index.toString().padStart(6)}  ${fmt(v.x).padStart(8)} ${fmt(v.y).padStart(8)} ${fmt(v.z).padStart(8)}  |  ${fmt(v.nx).padStart(8)} ${fmt(v.ny).padStart(8)} ${fmt(v.nz).padStart(8)}  |  ${fmt(v.u).padStart(8)} ${fmt(v.v).padStart(8)}`
      );
    });
  };

  printGroup("LEFT (Y < -0.03)", left);
  printGroup("RIGHT (Y > 0.03)", right);
  printGroup("CENTER (|Y| <= 0.03)", center);
}

// ──────────────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────────────────

console.log("Model: human-male");
console.log(`Vertex count: ${vertexCount}`);
console.log(`Index count: ${manifest.indexCount}`);
console.log(`Groups: ${manifest.groups.length}`);

// ── Geoset 0 (body mesh) ────────────────────────────────────────────────────
const geo0 = manifest.groups.find((g: any) => g.id === 0);
if (!geo0) {
  console.error("ERROR: Geoset 0 not found!");
  process.exit(1);
}
console.log(
  `\nGeoset 0: indexStart=${geo0.indexStart}, indexCount=${geo0.indexCount}, triangles=${geo0.indexCount / 3}`
);

const boundary0 = findBoundaryVertices(geo0.indexStart, geo0.indexCount);
console.log(`Geoset 0 total boundary vertices: ${boundary0.size}`);

// Show Z distribution of all boundary vertices in geoset 0
const allBoundary0 = Array.from(boundary0).map(getVertex);
const zValues0 = allBoundary0.map((v) => v.z).sort((a, b) => a - b);
console.log(
  `Geoset 0 boundary Z range: ${fmt(zValues0[0])} to ${fmt(zValues0[zValues0.length - 1])}`
);

// Histogram of boundary vertex Z values
console.log("\nGeoset 0 boundary vertex Z histogram (0.1 bins):");
const bins = new Map<string, number>();
for (const v of allBoundary0) {
  const binKey = (Math.floor(v.z * 10) / 10).toFixed(1);
  bins.set(binKey, (bins.get(binKey) || 0) + 1);
}
const sortedBins = Array.from(bins.entries()).sort(
  (a, b) => parseFloat(a[0]) - parseFloat(b[0])
);
for (const [bin, count] of sortedBins) {
  console.log(`  Z ${bin}: ${"#".repeat(count)} (${count})`);
}

// Extract waist boundary (Z 0.70 to 0.85)
const waistBoundary = getBoundaryVertsInZRange(boundary0, 0.7, 0.85);
printVertices("GEOSET 0 — WAIST BOUNDARY (Z 0.70–0.85)", waistBoundary);

// Also show nearby boundary vertices for context (Z 0.60–0.70 and Z 0.85–1.00)
const nearBelow = getBoundaryVertsInZRange(boundary0, 0.6, 0.7);
if (nearBelow.length > 0) {
  console.log(
    `\n  Note: ${nearBelow.length} boundary vertices at Z 0.60–0.70:`
  );
  nearBelow.forEach((v) =>
    console.log(`    vtx ${v.index}: (${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)})`)
  );
}
const nearAbove = getBoundaryVertsInZRange(boundary0, 0.85, 1.0);
if (nearAbove.length > 0) {
  console.log(
    `\n  Note: ${nearAbove.length} boundary vertices at Z 0.85–1.00:`
  );
  nearAbove.forEach((v) =>
    console.log(`    vtx ${v.index}: (${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)})`)
  );
}

// ── Geoset 501 (upper legs) ─────────────────────────────────────────────────
const geo501 = manifest.groups.find((g: any) => g.id === 501);
if (!geo501) {
  console.error("ERROR: Geoset 501 not found!");
  process.exit(1);
}
console.log(
  `\nGeoset 501: indexStart=${geo501.indexStart}, indexCount=${geo501.indexCount}, triangles=${geo501.indexCount / 3}`
);

const boundary501 = findBoundaryVertices(geo501.indexStart, geo501.indexCount);
console.log(`Geoset 501 total boundary vertices: ${boundary501.size}`);

// Show Z distribution
const allBoundary501 = Array.from(boundary501).map(getVertex);
const zValues501 = allBoundary501.map((v) => v.z).sort((a, b) => a - b);
console.log(
  `Geoset 501 boundary Z range: ${fmt(zValues501[0])} to ${fmt(zValues501[zValues501.length - 1])}`
);

// Histogram
console.log("\nGeoset 501 boundary vertex Z histogram (0.1 bins):");
const bins501 = new Map<string, number>();
for (const v of allBoundary501) {
  const binKey = (Math.floor(v.z * 10) / 10).toFixed(1);
  bins501.set(binKey, (bins501.get(binKey) || 0) + 1);
}
const sortedBins501 = Array.from(bins501.entries()).sort(
  (a, b) => parseFloat(a[0]) - parseFloat(b[0])
);
for (const [bin, count] of sortedBins501) {
  console.log(`  Z ${bin}: ${"#".repeat(count)} (${count})`);
}

// Extract top boundary (Z > 0.50)
const topBoundary501 = getBoundaryVertsInZRange(boundary501, 0.5, 2.0);
printVertices("GEOSET 501 — TOP BOUNDARY (Z > 0.50)", topBoundary501);

// ── Comparison ──────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(80)}`);
console.log("COMPARISON: Waist ring vs Leg top ring");
console.log("=".repeat(80));

const waistLeft = waistBoundary.filter((v) => classify(v.y) === "left");
const waistRight = waistBoundary.filter((v) => classify(v.y) === "right");
const waistCenter = waistBoundary.filter((v) => classify(v.y) === "center");

const legTopLeft = topBoundary501.filter((v) => classify(v.y) === "left");
const legTopRight = topBoundary501.filter((v) => classify(v.y) === "right");
const legTopCenter = topBoundary501.filter((v) => classify(v.y) === "center");

console.log(
  `Waist (geo0):   ${waistBoundary.length} total — ${waistLeft.length} left, ${waistRight.length} right, ${waistCenter.length} center`
);
console.log(
  `Leg top (501):  ${topBoundary501.length} total — ${legTopLeft.length} left, ${legTopRight.length} right, ${legTopCenter.length} center`
);

// Check for vertex sharing between geoset 0 and 501
const shared = new Set<number>();
for (const idx of boundary0) {
  if (boundary501.has(idx)) {
    shared.add(idx);
  }
}
if (shared.size > 0) {
  console.log(`\nShared boundary vertices between geoset 0 and 501: ${shared.size}`);
  for (const idx of shared) {
    const v = getVertex(idx);
    console.log(
      `  vtx ${idx}: (${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)}) [${classify(v.y)}]`
    );
  }
}

// Z gap analysis
if (waistBoundary.length > 0 && topBoundary501.length > 0) {
  const geo0MinZ = Math.min(...waistBoundary.map((v) => v.z));
  const geo0MaxZ = Math.max(...waistBoundary.map((v) => v.z));
  const geo501MinZ = Math.min(...topBoundary501.map((v) => v.z));
  const geo501MaxZ = Math.max(...topBoundary501.map((v) => v.z));

  console.log(`\nWaist boundary Z: ${fmt(geo0MinZ)} – ${fmt(geo0MaxZ)}`);
  console.log(`Leg top boundary Z: ${fmt(geo501MinZ)} – ${fmt(geo501MaxZ)}`);
  console.log(`Gap: ${fmt(geo501MaxZ)} to ${fmt(geo0MinZ)} = ${fmt(geo0MinZ - geo501MaxZ)} units`);
}

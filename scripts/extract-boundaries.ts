/**
 * extract-boundaries.ts
 *
 * Extracts boundary vertices from geoset 0 (body mesh, bottom boundary)
 * and geoset 501 (bare feet, top boundary) of the human-male model.
 *
 * A "boundary vertex" participates in at least one edge that belongs to
 * only a single triangle (an open/boundary edge of the mesh).
 *
 * Run: npx tsx scripts/extract-boundaries.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
const MODEL_DIR = path.resolve(__dirname, "../public/models");
const MANIFEST_PATH = path.join(MODEL_DIR, "human-male.json");
const BIN_PATH = path.join(MODEL_DIR, "human-male.bin");

const FLOATS_PER_VERTEX = 8; // pos(3) + normal(3) + uv(2)

// Z thresholds
const BODY_BOTTOM_Z_MAX = 0.8;
const FEET_TOP_Z_MIN = 0.5;

// --- Types ---
interface GeosetGroup {
  id: number;
  indexStart: number;
  indexCount: number;
}

interface Manifest {
  vertexCount: number;
  indexCount: number;
  vertexBufferSize: number;
  indexBufferSize: number;
  vertexStride: number;
  groups: GeosetGroup[];
}

interface Vertex {
  globalIndex: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  u: number;
  v: number;
}

// --- Load data ---
const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
const binBuf = fs.readFileSync(BIN_PATH);

// Vertex buffer starts at offset 0, index buffer follows
const vertexBuf = new Float32Array(
  binBuf.buffer,
  binBuf.byteOffset,
  manifest.vertexCount * FLOATS_PER_VERTEX
);
const indexBuf = new Uint16Array(
  binBuf.buffer,
  binBuf.byteOffset + manifest.vertexBufferSize,
  manifest.indexCount
);

function getVertex(globalIdx: number): Vertex {
  const off = globalIdx * FLOATS_PER_VERTEX;
  return {
    globalIndex: globalIdx,
    x: vertexBuf[off + 0],
    y: vertexBuf[off + 1],
    z: vertexBuf[off + 2],
    nx: vertexBuf[off + 3],
    ny: vertexBuf[off + 4],
    nz: vertexBuf[off + 5],
    u: vertexBuf[off + 6],
    v: vertexBuf[off + 7],
  };
}

// --- Edge map: find boundary edges ---
function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

interface BoundaryResult {
  boundaryVertexIndices: Set<number>;
  allVertexIndices: Set<number>;
}

function findBoundaryVertices(group: GeosetGroup): BoundaryResult {
  const edgeCounts = new Map<string, number>();
  const edgeVerts = new Map<string, [number, number]>();
  const allVertexIndices = new Set<number>();

  for (let i = 0; i < group.indexCount; i += 3) {
    const a = indexBuf[group.indexStart + i];
    const b = indexBuf[group.indexStart + i + 1];
    const c = indexBuf[group.indexStart + i + 2];
    allVertexIndices.add(a);
    allVertexIndices.add(b);
    allVertexIndices.add(c);

    for (const [v0, v1] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [number, number][]) {
      const key = edgeKey(v0, v1);
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      edgeVerts.set(key, [v0, v1]);
    }
  }

  const boundaryVertexIndices = new Set<number>();
  for (const [key, count] of edgeCounts) {
    if (count === 1) {
      const [v0, v1] = edgeVerts.get(key)!;
      boundaryVertexIndices.add(v0);
      boundaryVertexIndices.add(v1);
    }
  }

  return { boundaryVertexIndices, allVertexIndices };
}

function classifySide(y: number): string {
  if (Math.abs(y) < 0.05) return "center";
  return y < 0 ? "left" : "right";
}

function sortByAngle(
  vertices: Vertex[],
  centroidX: number,
  centroidY: number
): Vertex[] {
  return vertices.sort((a, b) => {
    const angleA = Math.atan2(a.y - centroidY, a.x - centroidX);
    const angleB = Math.atan2(b.y - centroidY, b.x - centroidX);
    return angleA - angleB;
  });
}

function printVertices(label: string, vertices: Vertex[]) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`${label}`);
  console.log(`${"=".repeat(80)}`);
  console.log(
    `${"Idx".padStart(5)}  ${"X".padStart(8)}  ${"Y".padStart(8)}  ${"Z".padStart(8)}  ${"U".padStart(8)}  ${"V".padStart(8)}  Side`
  );
  console.log("-".repeat(80));
  for (const v of vertices) {
    const side = classifySide(v.y);
    console.log(
      `${String(v.globalIndex).padStart(5)}  ${v.x.toFixed(4).padStart(8)}  ${v.y.toFixed(4).padStart(8)}  ${v.z.toFixed(4).padStart(8)}  ${v.u.toFixed(4).padStart(8)}  ${v.v.toFixed(4).padStart(8)}  ${side}`
    );
  }
}

function centroid(verts: Vertex[]): { cx: number; cy: number; cz: number } {
  const n = verts.length;
  if (n === 0) return { cx: 0, cy: 0, cz: 0 };
  const cx = verts.reduce((s, v) => s + v.x, 0) / n;
  const cy = verts.reduce((s, v) => s + v.y, 0) / n;
  const cz = verts.reduce((s, v) => s + v.z, 0) / n;
  return { cx, cy, cz };
}

// === GEOSET 0 (body, bottom boundary) ===
console.log("\n### GEOSET 0 — Body Mesh ###");
const bodyGroup = manifest.groups.find((g) => g.id === 0);
if (!bodyGroup) {
  console.error("Geoset 0 not found in manifest!");
  process.exit(1);
}
console.log(
  `Group: id=${bodyGroup.id}, indexStart=${bodyGroup.indexStart}, indexCount=${bodyGroup.indexCount}`
);
console.log(`Triangles: ${bodyGroup.indexCount / 3}`);

const bodyBoundary = findBoundaryVertices(bodyGroup);
console.log(`Total unique vertices in geoset 0: ${bodyBoundary.allVertexIndices.size}`);
console.log(`Total boundary vertices (all edges): ${bodyBoundary.boundaryVertexIndices.size}`);

const bodyBottomVerts: Vertex[] = [];
for (const idx of bodyBoundary.boundaryVertexIndices) {
  const v = getVertex(idx);
  if (v.z < BODY_BOTTOM_Z_MAX) {
    bodyBottomVerts.push(v);
  }
}
console.log(
  `Bottom boundary vertices (Z < ${BODY_BOTTOM_Z_MAX}): ${bodyBottomVerts.length}`
);

const bodyLeft = bodyBottomVerts.filter((v) => v.y < -0.05);
const bodyRight = bodyBottomVerts.filter((v) => v.y > 0.05);
const bodyCenter = bodyBottomVerts.filter((v) => Math.abs(v.y) <= 0.05);

const bodyLeftC = centroid(bodyLeft);
const bodyRightC = centroid(bodyRight);

console.log(
  `\nBody bottom — left leg:  ${bodyLeft.length} verts, centroid Y=${bodyLeftC.cy.toFixed(4)}, Z=${bodyLeftC.cz.toFixed(4)}`
);
console.log(
  `Body bottom — right leg: ${bodyRight.length} verts, centroid Y=${bodyRightC.cy.toFixed(4)}, Z=${bodyRightC.cz.toFixed(4)}`
);
if (bodyCenter.length > 0) {
  const bodyCenterC = centroid(bodyCenter);
  console.log(
    `Body bottom — center:    ${bodyCenter.length} verts, centroid Y=${bodyCenterC.cy.toFixed(4)}, Z=${bodyCenterC.cz.toFixed(4)}`
  );
}

const bodyLeftSorted = sortByAngle(bodyLeft, bodyLeftC.cx, bodyLeftC.cy);
const bodyRightSorted = sortByAngle(bodyRight, bodyRightC.cx, bodyRightC.cy);

printVertices(
  `GEOSET 0 — Bottom Boundary — LEFT LEG (Y < -0.05)  [centroid: X=${bodyLeftC.cx.toFixed(4)}, Y=${bodyLeftC.cy.toFixed(4)}]`,
  bodyLeftSorted
);
printVertices(
  `GEOSET 0 — Bottom Boundary — RIGHT LEG (Y > 0.05)  [centroid: X=${bodyRightC.cx.toFixed(4)}, Y=${bodyRightC.cy.toFixed(4)}]`,
  bodyRightSorted
);
if (bodyCenter.length > 0) {
  printVertices(`GEOSET 0 — Bottom Boundary — CENTER (|Y| <= 0.05)`, bodyCenter);
}

// === GEOSET 501 (bare feet, top boundary) ===
console.log("\n\n### GEOSET 501 — Bare Feet ###");
const feetGroup = manifest.groups.find((g) => g.id === 501);
if (!feetGroup) {
  console.error("Geoset 501 not found in manifest!");
  process.exit(1);
}
console.log(
  `Group: id=${feetGroup.id}, indexStart=${feetGroup.indexStart}, indexCount=${feetGroup.indexCount}`
);
console.log(`Triangles: ${feetGroup.indexCount / 3}`);

const feetBoundary = findBoundaryVertices(feetGroup);
console.log(`Total unique vertices in geoset 501: ${feetBoundary.allVertexIndices.size}`);
console.log(`Total boundary vertices (all edges): ${feetBoundary.boundaryVertexIndices.size}`);

const feetTopVerts: Vertex[] = [];
for (const idx of feetBoundary.boundaryVertexIndices) {
  const v = getVertex(idx);
  if (v.z > FEET_TOP_Z_MIN) {
    feetTopVerts.push(v);
  }
}
console.log(
  `Top boundary vertices (Z > ${FEET_TOP_Z_MIN}): ${feetTopVerts.length}`
);

const feetLeft = feetTopVerts.filter((v) => v.y < -0.05);
const feetRight = feetTopVerts.filter((v) => v.y > 0.05);
const feetCenter = feetTopVerts.filter((v) => Math.abs(v.y) <= 0.05);

const feetLeftC = centroid(feetLeft);
const feetRightC = centroid(feetRight);

console.log(
  `\nFeet top — left leg:  ${feetLeft.length} verts, centroid Y=${feetLeftC.cy.toFixed(4)}, Z=${feetLeftC.cz.toFixed(4)}`
);
console.log(
  `Feet top — right leg: ${feetRight.length} verts, centroid Y=${feetRightC.cy.toFixed(4)}, Z=${feetRightC.cz.toFixed(4)}`
);
if (feetCenter.length > 0) {
  const feetCenterC = centroid(feetCenter);
  console.log(
    `Feet top — center:    ${feetCenter.length} verts, centroid Y=${feetCenterC.cy.toFixed(4)}, Z=${feetCenterC.cz.toFixed(4)}`
  );
}

const feetLeftSorted = sortByAngle(feetLeft, feetLeftC.cx, feetLeftC.cy);
const feetRightSorted = sortByAngle(feetRight, feetRightC.cx, feetRightC.cy);

printVertices(
  `GEOSET 501 — Top Boundary — LEFT LEG (Y < -0.05)  [centroid: X=${feetLeftC.cx.toFixed(4)}, Y=${feetLeftC.cy.toFixed(4)}]`,
  feetLeftSorted
);
printVertices(
  `GEOSET 501 — Top Boundary — RIGHT LEG (Y > 0.05)  [centroid: X=${feetRightC.cx.toFixed(4)}, Y=${feetRightC.cy.toFixed(4)}]`,
  feetRightSorted
);
if (feetCenter.length > 0) {
  printVertices(`GEOSET 501 — Top Boundary — CENTER (|Y| <= 0.05)`, feetCenter);
}

// === ALIGNMENT SUMMARY ===
console.log("\n\n### ALIGNMENT SUMMARY ###");
console.log("=".repeat(80));
console.log(
  `Body (geoset 0) bottom boundary Z range:  ${bodyBottomVerts
    .map((v) => v.z)
    .reduce((a, b) => Math.min(a, b), Infinity)
    .toFixed(4)} — ${bodyBottomVerts
    .map((v) => v.z)
    .reduce((a, b) => Math.max(a, b), -Infinity)
    .toFixed(4)}`
);
console.log(
  `Feet (geoset 501) top boundary Z range:   ${feetTopVerts
    .map((v) => v.z)
    .reduce((a, b) => Math.min(a, b), Infinity)
    .toFixed(4)} — ${feetTopVerts
    .map((v) => v.z)
    .reduce((a, b) => Math.max(a, b), -Infinity)
    .toFixed(4)}`
);

console.log("\nPer-leg Y centroids:");
console.log(
  `  Left leg:  body Y=${bodyLeftC.cy.toFixed(4)}  feet Y=${feetLeftC.cy.toFixed(4)}  delta=${(bodyLeftC.cy - feetLeftC.cy).toFixed(4)}`
);
console.log(
  `  Right leg: body Y=${bodyRightC.cy.toFixed(4)}  feet Y=${feetRightC.cy.toFixed(4)}  delta=${(bodyRightC.cy - feetRightC.cy).toFixed(4)}`
);

console.log("\nPer-leg Z centroids:");
console.log(
  `  Left leg:  body Z=${bodyLeftC.cz.toFixed(4)}  feet Z=${feetLeftC.cz.toFixed(4)}  delta=${(bodyLeftC.cz - feetLeftC.cz).toFixed(4)}`
);
console.log(
  `  Right leg: body Z=${bodyRightC.cz.toFixed(4)}  feet Z=${feetRightC.cz.toFixed(4)}  delta=${(bodyRightC.cz - feetRightC.cz).toFixed(4)}`
);

console.log("\nVertex count comparison:");
console.log(`  Body left:  ${bodyLeft.length}    Feet left:  ${feetLeft.length}`);
console.log(`  Body right: ${bodyRight.length}    Feet right: ${feetRight.length}`);
if (bodyLeft.length === feetLeft.length && bodyRight.length === feetRight.length) {
  console.log("  MATCH: Same number of boundary vertices on each side.");
} else {
  console.log("  MISMATCH: Different boundary vertex counts!");
}

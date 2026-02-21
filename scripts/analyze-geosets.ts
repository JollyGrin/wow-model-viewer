/**
 * Analyze geoset geometry for human male model.
 * Focuses on groups 8xx, 9xx, 10xx, 11xx, and 12xx to understand
 * thigh/pants region coverage.
 *
 * Vertex format: 8 floats per vertex (pos3, normal3, uv2) = 32 bytes
 * Index format: uint16
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL_DIR = path.resolve(__dirname, '../public/models');
const manifestPath = path.join(MODEL_DIR, 'human-male.json');
const binPath = path.join(MODEL_DIR, 'human-male.bin');

interface Group {
  id: number;
  indexStart: number;
  indexCount: number;
}

interface Manifest {
  vertexBufferSize: number;
  indexBufferSize: number;
  vertexCount: number;
  indexCount: number;
  groups: Group[];
}

const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const bin = fs.readFileSync(binPath);

const VERTEX_STRIDE = 32; // 8 floats * 4 bytes
const vertexBuffer = bin.subarray(0, manifest.vertexBufferSize);
const indexBuffer = bin.subarray(manifest.vertexBufferSize, manifest.vertexBufferSize + manifest.indexBufferSize);

function readVertex(index: number): { x: number; y: number; z: number } {
  const offset = index * VERTEX_STRIDE;
  const x = vertexBuffer.readFloatLE(offset);
  const y = vertexBuffer.readFloatLE(offset + 4);
  const z = vertexBuffer.readFloatLE(offset + 8);
  return { x, y, z };
}

function readIndex(i: number): number {
  return indexBuffer.readUInt16LE(i * 2);
}

const THIGH_GAP_Z_MIN = 0.20;
const THIGH_GAP_Z_MAX = 0.72;

console.log('=== Human Male Geoset Geometry Analysis ===\n');
console.log(`Total vertices: ${manifest.vertexCount}`);
console.log(`Total indices: ${manifest.indexCount}`);
console.log(`Vertex buffer: ${manifest.vertexBufferSize} bytes`);
console.log(`Index buffer: ${manifest.indexBufferSize} bytes`);
console.log(`Total geoset groups: ${manifest.groups.length}\n`);

// Group by hundreds
const groupsByHundred = new Map<number, Group[]>();
for (const g of manifest.groups) {
  const hundred = Math.floor(g.id / 100);
  if (!groupsByHundred.has(hundred)) groupsByHundred.set(hundred, []);
  groupsByHundred.get(hundred)!.push(g);
}

console.log('=== All Geoset Groups (sorted by group family) ===\n');
const sortedHundreds = [...groupsByHundred.keys()].sort((a, b) => a - b);
for (const h of sortedHundreds) {
  const groups = groupsByHundred.get(h)!;
  const ids = groups.map(g => g.id).join(', ');
  console.log(`  ${h}xx: [${ids}]`);
}
console.log('');

// Analyze each group in detail for target families
const TARGET_FAMILIES = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 15];

console.log('=== Detailed Geoset Analysis ===\n');
console.log('Thigh gap zone: Z 0.20 to Z 0.72\n');

for (const family of TARGET_FAMILIES) {
  const groups = groupsByHundred.get(family);
  if (!groups) continue;

  console.log(`--- Group Family ${family}xx ---`);
  
  for (const group of groups.sort((a, b) => a.id - b.id)) {
    const vertexIndices = new Set<number>();
    for (let i = 0; i < group.indexCount; i++) {
      vertexIndices.add(readIndex(group.indexStart + i));
    }

    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    let zMin = Infinity, zMax = -Infinity;
    let thighGapVerts = 0;

    for (const vi of vertexIndices) {
      const v = readVertex(vi);
      if (v.x < xMin) xMin = v.x;
      if (v.x > xMax) xMax = v.x;
      if (v.y < yMin) yMin = v.y;
      if (v.y > yMax) yMax = v.y;
      if (v.z < zMin) zMin = v.z;
      if (v.z > zMax) zMax = v.z;
      if (v.z >= THIGH_GAP_Z_MIN && v.z <= THIGH_GAP_Z_MAX) thighGapVerts++;
    }

    const triangles = group.indexCount / 3;
    const overlapPercent = vertexIndices.size > 0 
      ? ((thighGapVerts / vertexIndices.size) * 100).toFixed(1) 
      : '0.0';
    const inThighZone = thighGapVerts > 0;

    console.log(`  Geoset ${group.id}:`);
    console.log(`    Triangles: ${triangles} (${group.indexCount} indices, ${vertexIndices.size} unique verts)`);
    console.log(`    X range: ${xMin.toFixed(3)} to ${xMax.toFixed(3)} (width: ${(xMax - xMin).toFixed(3)})`);
    console.log(`    Y range: ${yMin.toFixed(3)} to ${yMax.toFixed(3)} (depth: ${(yMax - yMin).toFixed(3)})`);
    console.log(`    Z range: ${zMin.toFixed(3)} to ${zMax.toFixed(3)} (height: ${(zMax - zMin).toFixed(3)})`);
    console.log(`    Thigh gap overlap: ${inThighZone ? 'YES' : 'NO'} (${thighGapVerts}/${vertexIndices.size} verts = ${overlapPercent}%)`);
    console.log('');
  }
}

// Check which key geosets exist vs missing
console.log('=== Key Comparison: Pants Region Geosets ===\n');

const keyGeosets = [0, 801, 802, 803, 901, 902, 903, 1001, 1002, 1101, 1102, 1201, 1202];
const found: number[] = [];
const missing: number[] = [];

for (const id of keyGeosets) {
  const matches = manifest.groups.filter(g => g.id === id);
  if (matches.length > 0) {
    found.push(id);
  } else {
    missing.push(id);
  }
}

console.log(`Found geosets: [${found.join(', ')}]`);
console.log(`Missing geosets: [${missing.join(', ')}]`);
console.log('');

// Geoset group meaning reference
console.log('=== WoW Geoset Group Reference ===\n');
console.log('  Group 0xx: Base body (id 0 = default skin mesh)');
console.log('  Group 1xx: Facial hair / features');
console.log('  Group 2xx: Facial feature variant');
console.log('  Group 3xx: Facial feature variant');
console.log('  Group 4xx: Gloves / bracers');
console.log('  Group 5xx: Boots / feet');
console.log('  Group 7xx: Ears');
console.log('  Group 8xx: Sleeves / shirt lower arms');
console.log('  Group 9xx: Legs lower (pants calf/knee)');
console.log('  Group 10xx: Tabard');
console.log('  Group 11xx: Legs upper (pants thigh / kilt)');
console.log('  Group 12xx: Tabard lower?');
console.log('  Group 13xx: Robe bottom / long dress');
console.log('  Group 15xx: Cape / cloak');
console.log('');

// Deep dive: which geosets have geometry in the thigh zone
console.log('=== Thigh Area Deep Dive (Z 0.20 to 0.72) ===\n');

for (const group of manifest.groups) {
  const vertexIndices = new Set<number>();
  for (let i = 0; i < group.indexCount; i++) {
    vertexIndices.add(readIndex(group.indexStart + i));
  }

  let thighVerts = 0;
  let thighXMin = Infinity, thighXMax = -Infinity;
  let thighYMin = Infinity, thighYMax = -Infinity;
  let thighZMin = Infinity, thighZMax = -Infinity;

  for (const vi of vertexIndices) {
    const v = readVertex(vi);
    if (v.z >= THIGH_GAP_Z_MIN && v.z <= THIGH_GAP_Z_MAX) {
      thighVerts++;
      if (v.x < thighXMin) thighXMin = v.x;
      if (v.x > thighXMax) thighXMax = v.x;
      if (v.y < thighYMin) thighYMin = v.y;
      if (v.y > thighYMax) thighYMax = v.y;
      if (v.z < thighZMin) thighZMin = v.z;
      if (v.z > thighZMax) thighZMax = v.z;
    }
  }

  if (thighVerts > 3) {
    console.log(`  Geoset ${group.id} (indexStart=${group.indexStart}): ${thighVerts} thigh-zone verts`);
    console.log(`    X: ${thighXMin.toFixed(3)} to ${thighXMax.toFixed(3)}`);
    console.log(`    Y: ${thighYMin.toFixed(3)} to ${thighYMax.toFixed(3)}`);
    console.log(`    Z: ${thighZMin.toFixed(3)} to ${thighZMax.toFixed(3)}`);
  }
}

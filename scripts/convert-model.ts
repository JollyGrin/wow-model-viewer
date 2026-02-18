/**
 * Convert vanilla M2 (version 256) to web-friendly format.
 *
 * The M2 v256 header differs from WotLK (264+) in two ways:
 * 1. Extra M2Array `playableAnimLookup` after `animationLookup` (+8 bytes)
 * 2. `views` is an M2Array (8 bytes) instead of `uint32 numSkinProfiles` (4 bytes)
 *
 * Additionally, embedded skin data uses:
 * - 32-byte submesh structs (not 48) — no sortCenterPosition/sortRadius
 * - 24-byte batch structs (not 26)
 *
 * Output:
 * - public/models/human-male.bin  (vertex buffer + index buffer)
 * - public/models/human-male.json (manifest with layout info)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const M2_PATH = resolve(ROOT, 'data/patch/patch-3/Character/Human/Male/HumanMale.m2');
const OUT_DIR = resolve(ROOT, 'public/models');
const OUT_BIN = resolve(OUT_DIR, 'human-male.bin');
const OUT_JSON = resolve(OUT_DIR, 'human-male.json');

// --- M2 v256 Header Parser ---

interface M2Arr { count: number; ofs: number; }

function parseM2v256(buf: Buffer) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  function arr(off: number): M2Arr {
    return { count: view.getUint32(off, true), ofs: view.getUint32(off + 4, true) };
  }

  let off = 0;
  const magic = buf.toString('ascii', 0, 4); off += 4;
  if (magic !== 'MD20') throw new Error(`Bad magic: ${magic}`);

  const version = view.getUint32(off, true); off += 4;
  if (version !== 256) throw new Error(`Expected version 256, got ${version}`);

  const name = arr(off); off += 8;
  off += 4; // globalFlags
  off += 8; // globalSequences
  off += 8; // animations
  off += 8; // animationLookup
  off += 8; // playableAnimLookup (v256 EXTRA)
  off += 8; // bones
  off += 8; // keyBoneLookup
  const vertices = arr(off); off += 8;
  const views = arr(off); off += 8;

  const nameStr = buf.toString('ascii', name.ofs, name.ofs + name.count).replace(/\0/g, '').trim();

  return { nameStr, vertices, views, buf, view };
}

// --- View/Skin Parser ---

interface Submesh {
  id: number;
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
}

function parseView0(buf: Buffer, view: DataView, viewsArr: M2Arr) {
  function arr(off: number): M2Arr {
    return { count: view.getUint32(off, true), ofs: view.getUint32(off + 4, true) };
  }

  // View header: 5 M2Arrays + 1 uint32 = 44 bytes
  const viewOfs = viewsArr.ofs;
  const vertexIndices = arr(viewOfs);      // maps skin vertex idx -> model vertex idx
  const triangleIndices = arr(viewOfs + 8); // triangle index list
  const submeshesArr = arr(viewOfs + 24);   // submesh definitions (skip properties at +16)

  // Read vertex remap (uint16)
  const remap = new Uint16Array(vertexIndices.count);
  for (let i = 0; i < vertexIndices.count; i++) {
    remap[i] = view.getUint16(vertexIndices.ofs + i * 2, true);
  }

  // Read triangle indices (uint16) — these index into the remap array
  const rawTriangles = new Uint16Array(triangleIndices.count);
  for (let i = 0; i < triangleIndices.count; i++) {
    rawTriangles[i] = view.getUint16(triangleIndices.ofs + i * 2, true);
  }

  // Parse submeshes (32 bytes each for v256)
  const submeshes: Submesh[] = [];
  const SUBMESH_SIZE = 32;
  for (let s = 0; s < submeshesArr.count; s++) {
    const so = submeshesArr.ofs + s * SUBMESH_SIZE;
    submeshes.push({
      id: view.getUint16(so, true),
      vertexStart: view.getUint16(so + 4, true),
      vertexCount: view.getUint16(so + 6, true),
      indexStart: view.getUint16(so + 8, true),
      indexCount: view.getUint16(so + 10, true),
    });
  }

  return { remap, rawTriangles, submeshes };
}

// --- Main ---

function main() {
  const buf = readFileSync(M2_PATH);
  console.log(`M2 file: ${M2_PATH}`);
  console.log(`M2 size: ${buf.byteLength} bytes`);

  const m2 = parseM2v256(buf);
  console.log(`Model name: "${m2.nameStr}"`);
  console.log(`Vertices: ${m2.vertices.count}`);
  console.log(`Views: ${m2.views.count}`);

  const skin = parseView0(buf, m2.view, m2.views);
  console.log(`\nView 0:`);
  console.log(`  Vertex remap entries: ${skin.remap.length}`);
  console.log(`  Triangle indices: ${skin.rawTriangles.length} (${skin.rawTriangles.length / 3} triangles)`);
  console.log(`  Submeshes: ${skin.submeshes.length}`);

  // Build output vertex buffer using the remap
  // Each vertex in the M2 is 48 bytes: pos(3f) boneWeights(4u8) boneIndices(4u8) normal(3f) uv1(2f) uv2(2f)
  // For the browser: position (3f, 12B) + normal (3f, 12B) + uv (2f, 8B) = 32 bytes per vertex
  const vertexCount = skin.remap.length;
  const BROWSER_VERTEX_SIZE = 32; // 3 floats position + 3 floats normal + 2 floats uv
  const vertexBuffer = new Float32Array(vertexCount * 8); // 8 floats per vertex

  for (let i = 0; i < vertexCount; i++) {
    const modelIdx = skin.remap[i];
    const srcOfs = m2.vertices.ofs + modelIdx * 48;

    // Position: offset 0, 3 floats (12 bytes)
    vertexBuffer[i * 8 + 0] = m2.view.getFloat32(srcOfs + 0, true);
    vertexBuffer[i * 8 + 1] = m2.view.getFloat32(srcOfs + 4, true);
    vertexBuffer[i * 8 + 2] = m2.view.getFloat32(srcOfs + 8, true);

    // Normal: offset 20 (after pos(12) + boneWeights(4) + boneIndices(4))
    vertexBuffer[i * 8 + 3] = m2.view.getFloat32(srcOfs + 20, true);
    vertexBuffer[i * 8 + 4] = m2.view.getFloat32(srcOfs + 24, true);
    vertexBuffer[i * 8 + 5] = m2.view.getFloat32(srcOfs + 28, true);

    // UV1: offset 32 (after normal(12)), 2 floats (8 bytes)
    vertexBuffer[i * 8 + 6] = m2.view.getFloat32(srcOfs + 32, true);
    vertexBuffer[i * 8 + 7] = m2.view.getFloat32(srcOfs + 36, true);
  }

  // Build index buffer — triangle indices already reference the remap array
  const indexBuffer = skin.rawTriangles;

  // Build submesh groups (filter out empty placeholder submeshes)
  const groups = skin.submeshes
    .filter(s => s.indexCount > 0 && s.id !== 65535)
    .map(s => ({
      id: s.id,
      indexStart: s.indexStart,
      indexCount: s.indexCount,
    }));

  // Write binary: vertex buffer + index buffer
  const vertexBytes = new Uint8Array(vertexBuffer.buffer);
  const indexBytes = new Uint8Array(indexBuffer.buffer);
  const binData = new Uint8Array(vertexBytes.byteLength + indexBytes.byteLength);
  binData.set(vertexBytes, 0);
  binData.set(indexBytes, vertexBytes.byteLength);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_BIN, binData);

  // Write manifest
  const manifest = {
    vertexCount,
    indexCount: indexBuffer.length,
    triangleCount: Math.floor(indexBuffer.length / 3),
    vertexBufferSize: vertexBytes.byteLength,
    indexBufferSize: indexBytes.byteLength,
    vertexStride: BROWSER_VERTEX_SIZE,
    groups,
  };
  writeFileSync(OUT_JSON, JSON.stringify(manifest, null, 2));

  // Summary
  console.log(`\n=== Output ===`);
  console.log(`Vertex count: ${vertexCount}`);
  console.log(`Triangle count: ${manifest.triangleCount}`);
  console.log(`Groups: ${groups.length}`);
  console.log(`Vertex buffer: ${vertexBytes.byteLength} bytes`);
  console.log(`Index buffer: ${indexBytes.byteLength} bytes`);
  console.log(`Total binary: ${binData.byteLength} bytes`);
  console.log(`\nGroups:`);
  for (const g of groups) {
    console.log(`  id=${g.id} indexStart=${g.indexStart} indexCount=${g.indexCount} (${g.indexCount / 3} tris)`);
  }
  console.log(`\nFiles written:`);
  console.log(`  ${OUT_BIN}`);
  console.log(`  ${OUT_JSON}`);

  // Sanity checks
  const maxIdx = Math.max(...Array.from(indexBuffer));
  console.log(`\nMax index value: ${maxIdx} (vertex count: ${vertexCount})`);
  if (maxIdx >= vertexCount) {
    console.error(`ERROR: index ${maxIdx} out of range!`);
    process.exit(1);
  }

  // Check first vertex values are reasonable
  console.log(`\nFirst 3 vertices (remapped):`);
  for (let i = 0; i < 3; i++) {
    const px = vertexBuffer[i*8], py = vertexBuffer[i*8+1], pz = vertexBuffer[i*8+2];
    const nx = vertexBuffer[i*8+3], ny = vertexBuffer[i*8+4], nz = vertexBuffer[i*8+5];
    const u = vertexBuffer[i*8+6], v = vertexBuffer[i*8+7];
    console.log(`  v${i}: pos=(${px.toFixed(3)}, ${py.toFixed(3)}, ${pz.toFixed(3)}) normal=(${nx.toFixed(3)}, ${ny.toFixed(3)}, ${nz.toFixed(3)}) uv=(${u.toFixed(4)}, ${v.toFixed(4)})`);
  }
}

main();

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
 * Output per model:
 * - public/models/<slug>/model.bin  (vertex buffer + index buffer)
 * - public/models/<slug>/model.json (manifest with layout info)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

interface CharacterModel {
  slug: string;
  m2Path: string;
}

const CHARACTER_MODELS: CharacterModel[] = [
  { slug: 'blood-elf-male',    m2Path: 'data/patch/patch-6/Character/BloodElf/Male/BloodElfMale.M2' },
  { slug: 'blood-elf-female',  m2Path: 'data/patch/patch-6/Character/BloodElf/Female/BloodElfFemale.M2' },
  { slug: 'dwarf-male',        m2Path: 'data/patch/patch-6/Character/Dwarf/Male/DwarfMale.M2' },
  { slug: 'dwarf-female',      m2Path: 'data/patch/patch-6/Character/Dwarf/Female/DwarfFemale.M2' },
  { slug: 'gnome-male',        m2Path: 'data/patch/patch-6/Character/Gnome/Male/GnomeMale.M2' },
  { slug: 'gnome-female',      m2Path: 'data/patch/patch-6/Character/Gnome/Female/GnomeFemale.M2' },
  { slug: 'goblin-male',       m2Path: 'data/patch/patch-7/Character/Goblin/Male/GoblinMale.m2' },
  { slug: 'goblin-female',     m2Path: 'data/patch/patch-7/Character/Goblin/Female/GoblinFemale.m2' },
  { slug: 'human-male',        m2Path: 'data/patch/patch-6/Character/Human/Male/HumanMale.m2' },
  { slug: 'human-female',      m2Path: 'data/patch/patch-6/Character/Human/Female/HumanFemale.M2' },
  { slug: 'night-elf-male',    m2Path: 'data/patch/patch-6/Character/NightElf/Male/NightElfMale.M2' },
  { slug: 'night-elf-female',  m2Path: 'data/patch/patch-6/Character/NightElf/Female/NightElfFemale.M2' },
  { slug: 'orc-male',          m2Path: 'data/patch/patch-6/Character/Orc/Male/OrcMale.M2' },
  { slug: 'orc-female',        m2Path: 'data/patch/patch-6/Character/Orc/Female/OrcFemale.M2' },
  { slug: 'scourge-male',      m2Path: 'data/patch/patch-6/Character/Scourge/Male/ScourgeMale.M2' },
  { slug: 'scourge-female',    m2Path: 'data/patch/patch-6/Character/Scourge/Female/ScourgeFemale.M2' },
  { slug: 'tauren-male',       m2Path: 'data/patch/patch-6/Character/Tauren/Male/TaurenMale.M2' },
  { slug: 'tauren-female',     m2Path: 'data/patch/patch-6/Character/Tauren/Female/TaurenFemale.M2' },
  { slug: 'troll-male',        m2Path: 'data/patch/patch-6/Character/Troll/Male/TrollMale.M2' },
  { slug: 'troll-female',      m2Path: 'data/patch/patch-6/Character/Troll/Female/TrollFemale.M2' },
];

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

function parseView0(_buf: Buffer, view: DataView, viewsArr: M2Arr) {
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

// --- Convert a single model ---

function convertModel(model: CharacterModel) {
  const m2FullPath = resolve(ROOT, model.m2Path);
  const outDir = resolve(ROOT, 'public/models', model.slug);
  const outBin = resolve(outDir, 'model.bin');
  const outJson = resolve(outDir, 'model.json');

  const buf = readFileSync(m2FullPath);
  const m2 = parseM2v256(buf);
  const skin = parseView0(buf, m2.view, m2.views);

  // Build output vertex buffer using the remap
  // Each vertex in the M2 is 48 bytes: pos(3f) boneWeights(4u8) boneIndices(4u8) normal(3f) uv1(2f) uv2(2f)
  // For the browser: position (3f, 12B) + normal (3f, 12B) + uv (2f, 8B) = 32 bytes per vertex
  const vertexCount = skin.remap.length;
  const BROWSER_VERTEX_SIZE = 32;
  const vertexBuffer = new Float32Array(vertexCount * 8);

  for (let i = 0; i < vertexCount; i++) {
    const modelIdx = skin.remap[i];
    const srcOfs = m2.vertices.ofs + modelIdx * 48;

    vertexBuffer[i * 8 + 0] = m2.view.getFloat32(srcOfs + 0, true);
    vertexBuffer[i * 8 + 1] = m2.view.getFloat32(srcOfs + 4, true);
    vertexBuffer[i * 8 + 2] = m2.view.getFloat32(srcOfs + 8, true);

    vertexBuffer[i * 8 + 3] = m2.view.getFloat32(srcOfs + 20, true);
    vertexBuffer[i * 8 + 4] = m2.view.getFloat32(srcOfs + 24, true);
    vertexBuffer[i * 8 + 5] = m2.view.getFloat32(srcOfs + 28, true);

    vertexBuffer[i * 8 + 6] = m2.view.getFloat32(srcOfs + 32, true);
    vertexBuffer[i * 8 + 7] = m2.view.getFloat32(srcOfs + 36, true);
  }

  const indexBuffer = skin.rawTriangles;

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

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outBin, binData);

  const manifest = {
    vertexCount,
    indexCount: indexBuffer.length,
    triangleCount: Math.floor(indexBuffer.length / 3),
    vertexBufferSize: vertexBytes.byteLength,
    indexBufferSize: indexBytes.byteLength,
    vertexStride: BROWSER_VERTEX_SIZE,
    groups,
  };
  writeFileSync(outJson, JSON.stringify(manifest, null, 2));

  // Sanity check
  const maxIdx = Math.max(...Array.from(indexBuffer));
  if (maxIdx >= vertexCount) {
    console.error(`  ERROR: ${model.slug} index ${maxIdx} out of range (${vertexCount} verts)!`);
    process.exit(1);
  }

  return { vertexCount, triangleCount: manifest.triangleCount, groupCount: groups.length, binSize: binData.byteLength };
}

// --- Main ---

function main() {
  console.log(`Converting ${CHARACTER_MODELS.length} character models...\n`);

  let totalModels = 0;
  let totalTris = 0;

  for (const model of CHARACTER_MODELS) {
    const result = convertModel(model);
    console.log(`${model.slug}: ${result.vertexCount} verts, ${result.triangleCount} tris, ${result.groupCount} groups, ${result.binSize} bytes`);
    totalModels++;
    totalTris += result.triangleCount;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Models converted: ${totalModels}`);
  console.log(`Total triangles: ${totalTris}`);
}

main();

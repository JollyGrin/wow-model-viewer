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
  const bones = arr(off); off += 8;
  off += 8; // keyBoneLookup
  const vertices = arr(off); off += 8;
  const views = arr(off); off += 8;

  const nameStr = buf.toString('ascii', name.ofs, name.ofs + name.count).replace(/\0/g, '').trim();

  return { nameStr, vertices, views, bones, buf, view };
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

// --- Bone Transform (bake Stand animation frame 0 into vertices) ---
//
// M2CompBone for v256 = 108 bytes:
//   keyBoneId(4) + flags(4) + parentBone(2) + submeshId(2) +
//   translation M2Track(28) + rotation M2Track(28) + scale M2Track(28) +
//   pivot float32[3](12)
//
// M2Track for v256 = 28 bytes:
//   interp(2) + globalSeq(2) + ranges M2Array(8) + timestamps M2Array(8) + values M2Array(8)
//
// Rotation values are float32 quaternions (16 bytes each), NOT CompQuat.
// Translation values are float32[3] (12 bytes each).

const BONE_SIZE = 108;

interface BoneData {
  parentBone: number;
  pivot: [number, number, number];
  rotation: [number, number, number, number];
  translation: [number, number, number];
}

function parseBoneTransforms(view: DataView, bonesArr: M2Arr): BoneData[] {
  function arr(off: number): M2Arr {
    return { count: view.getUint32(off, true), ofs: view.getUint32(off + 4, true) };
  }

  const bones: BoneData[] = [];

  for (let i = 0; i < bonesArr.count; i++) {
    const bo = bonesArr.ofs + i * BONE_SIZE;

    const parentBone = view.getInt16(bo + 8, true);
    const pivot: [number, number, number] = [
      view.getFloat32(bo + 96, true),
      view.getFloat32(bo + 100, true),
      view.getFloat32(bo + 104, true),
    ];

    // Translation track at bone offset + 12, values at +32 (12+20)
    let translation: [number, number, number] = [0, 0, 0];
    const transTimestamps = arr(bo + 12 + 12);
    if (transTimestamps.count > 0) {
      const transRanges = arr(bo + 12 + 4);
      const transValues = arr(bo + 12 + 20);
      let si = 0;
      if (transRanges.count > 0) si = view.getUint32(transRanges.ofs, true);
      if (si < transValues.count) {
        const o = transValues.ofs + si * 12;
        translation = [
          view.getFloat32(o, true),
          view.getFloat32(o + 4, true),
          view.getFloat32(o + 8, true),
        ];
      }
    }

    // Rotation track at bone offset + 40, values at +60 (40+20)
    let rotation: [number, number, number, number] = [0, 0, 0, 1];
    const rotTimestamps = arr(bo + 40 + 12);
    if (rotTimestamps.count > 0) {
      const rotRanges = arr(bo + 40 + 4);
      const rotValues = arr(bo + 40 + 20);
      let si = 0;
      if (rotRanges.count > 0) si = view.getUint32(rotRanges.ofs, true);
      if (si < rotValues.count) {
        const o = rotValues.ofs + si * 16; // float32 quat = 16 bytes
        const q: [number, number, number, number] = [
          view.getFloat32(o, true),
          view.getFloat32(o + 4, true),
          view.getFloat32(o + 8, true),
          view.getFloat32(o + 12, true),
        ];
        const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
        if (len > 0.001) {
          rotation = [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
        }
      }
    }

    bones.push({ parentBone, pivot, rotation, translation });
  }

  return bones;
}

function quatMul(a: number[], b: number[]): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function quatRot(q: number[], v: number[]): [number, number, number] {
  const r = quatMul(quatMul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [r[0], r[1], r[2]];
}

/** Transform position through bone hierarchy: pivot + rot * (pos - pivot) + trans */
function transformPos(pos: number[], boneIdx: number, bones: BoneData[]): [number, number, number] {
  const chain: number[] = [];
  let c = boneIdx;
  while (c >= 0) { chain.unshift(c); c = bones[c].parentBone; }

  let p = [pos[0], pos[1], pos[2]];
  for (const bi of chain) {
    const b = bones[bi];
    const rel = [p[0] - b.pivot[0], p[1] - b.pivot[1], p[2] - b.pivot[2]];
    const r = quatRot(b.rotation, rel);
    p = [r[0] + b.pivot[0] + b.translation[0],
         r[1] + b.pivot[1] + b.translation[1],
         r[2] + b.pivot[2] + b.translation[2]];
  }
  return [p[0], p[1], p[2]];
}

/** Transform normal through bone hierarchy (rotation only) */
function transformNorm(normal: number[], boneIdx: number, bones: BoneData[]): [number, number, number] {
  const chain: number[] = [];
  let c = boneIdx;
  while (c >= 0) { chain.unshift(c); c = bones[c].parentBone; }

  let n = [normal[0], normal[1], normal[2]];
  for (const bi of chain) {
    n = quatRot(bones[bi].rotation, n);
  }
  const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
  if (len > 0.001) return [n[0] / len, n[1] / len, n[2] / len];
  return [normal[0], normal[1], normal[2]];
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
  const bones = parseBoneTransforms(m2.view, m2.bones);

  // Build output vertex buffer using the remap, with Stand pose baked in.
  // Each M2 vertex is 48 bytes: pos(3f) boneWeights(4u8) boneIndices(4u8) normal(3f) uv1(2f) uv2(2f)
  // For the browser: position (3f, 12B) + normal (3f, 12B) + uv (2f, 8B) = 32 bytes per vertex
  const vertexCount = skin.remap.length;
  const BROWSER_VERTEX_SIZE = 32;
  const vertexBuffer = new Float32Array(vertexCount * 8);

  for (let i = 0; i < vertexCount; i++) {
    const modelIdx = skin.remap[i];
    const srcOfs = m2.vertices.ofs + modelIdx * 48;

    const pos = [
      m2.view.getFloat32(srcOfs + 0, true),
      m2.view.getFloat32(srcOfs + 4, true),
      m2.view.getFloat32(srcOfs + 8, true),
    ];
    const normal = [
      m2.view.getFloat32(srcOfs + 20, true),
      m2.view.getFloat32(srcOfs + 24, true),
      m2.view.getFloat32(srcOfs + 28, true),
    ];

    // Bone weights (bytes 12-15) and indices (bytes 16-19) from M2 vertex data.
    // Indices are direct global bone references. Weights sum to 255.
    const weights = [buf[srcOfs + 12], buf[srcOfs + 13], buf[srcOfs + 14], buf[srcOfs + 15]];
    const boneIdx = [buf[srcOfs + 16], buf[srcOfs + 17], buf[srcOfs + 18], buf[srcOfs + 19]];

    let tPos = [0, 0, 0];
    let tNorm = [0, 0, 0];
    let totalWeight = 0;

    for (let b = 0; b < 4; b++) {
      if (weights[b] === 0) continue;
      const bi = boneIdx[b];
      if (bi >= bones.length) continue;
      const w = weights[b] / 255;
      totalWeight += w;

      const tp = transformPos(pos, bi, bones);
      const tn = transformNorm(normal, bi, bones);
      tPos[0] += tp[0] * w; tPos[1] += tp[1] * w; tPos[2] += tp[2] * w;
      tNorm[0] += tn[0] * w; tNorm[1] += tn[1] * w; tNorm[2] += tn[2] * w;
    }

    if (totalWeight < 0.001) {
      tPos = pos;
      tNorm = normal;
    } else {
      // Renormalize blended normal
      const nLen = Math.sqrt(tNorm[0] * tNorm[0] + tNorm[1] * tNorm[1] + tNorm[2] * tNorm[2]);
      if (nLen > 0.001) { tNorm[0] /= nLen; tNorm[1] /= nLen; tNorm[2] /= nLen; }
    }

    vertexBuffer[i * 8 + 0] = tPos[0];
    vertexBuffer[i * 8 + 1] = tPos[1];
    vertexBuffer[i * 8 + 2] = tPos[2];
    vertexBuffer[i * 8 + 3] = tNorm[0];
    vertexBuffer[i * 8 + 4] = tNorm[1];
    vertexBuffer[i * 8 + 5] = tNorm[2];
    vertexBuffer[i * 8 + 6] = m2.view.getFloat32(srcOfs + 32, true);
    vertexBuffer[i * 8 + 7] = m2.view.getFloat32(srcOfs + 36, true);
  }

  // --- Post-process: stretch body barrel bottom to cover the thigh gap ---
  // The body mesh (geoset 0) has a wide barrel at the waist with a hole below
  // for leg geosets. Upper legs (geoset 903) are narrower. In WoW, clothing
  // always covers this gap. We stretch the barrel bottom down aggressively to
  // overlap with the upper legs, creating a "skirt" that covers the crotch gap.
  // We also narrow the barrel and widen 903 so the edges match.
  const bodySubmeshes = skin.submeshes.filter(s => s.id === 0);
  const upperLegSubmeshes = skin.submeshes.filter(s => s.id === 903);

  if (bodySubmeshes.length > 0 && upperLegSubmeshes.length > 0) {
    // Find body gap zone bottom (Z where body resumes above the thigh hole)
    const bodyZValues: number[] = [];
    for (const sub of bodySubmeshes) {
      for (let vi = sub.vertexStart; vi < sub.vertexStart + sub.vertexCount; vi++) {
        bodyZValues.push(vertexBuffer[vi * 8 + 2]);
      }
    }
    bodyZValues.sort((a, b) => a - b);
    let bodyGapTopZ = 0;
    for (let i = 1; i < bodyZValues.length; i++) {
      if (bodyZValues[i] - bodyZValues[i - 1] > 0.15 && bodyZValues[i] > 0.3) {
        bodyGapTopZ = bodyZValues[i];
        break;
      }
    }

    // Find 903 extents
    let leg903TopZ = -Infinity;
    let leg903MidZ = 0;
    let leg903Count = 0;
    for (const sub of upperLegSubmeshes) {
      for (let vi = sub.vertexStart; vi < sub.vertexStart + sub.vertexCount; vi++) {
        const z = vertexBuffer[vi * 8 + 2];
        leg903TopZ = Math.max(leg903TopZ, z);
        leg903MidZ += z;
        leg903Count++;
      }
    }
    leg903MidZ /= (leg903Count || 1);

    let leg903MaxY = 0;
    for (const sub of upperLegSubmeshes) {
      for (let vi = sub.vertexStart; vi < sub.vertexStart + sub.vertexCount; vi++) {
        if (vertexBuffer[vi * 8 + 2] > leg903TopZ - 0.06) {
          leg903MaxY = Math.max(leg903MaxY, Math.abs(vertexBuffer[vi * 8 + 1]));
        }
      }
    }

    if (bodyGapTopZ > 0 && leg903MaxY > 0) {
      // Body width at barrel bottom
      let bodyBottomMaxY = 0;
      for (const sub of bodySubmeshes) {
        for (let vi = sub.vertexStart; vi < sub.vertexStart + sub.vertexCount; vi++) {
          const z = vertexBuffer[vi * 8 + 2];
          if (z >= bodyGapTopZ && z < bodyGapTopZ + 0.06) {
            bodyBottomMaxY = Math.max(bodyBottomMaxY, Math.abs(vertexBuffer[vi * 8 + 1]));
          }
        }
      }

      if (bodyBottomMaxY > leg903MaxY) {
        // 1. TAPER: narrow body barrel bottom to match 903 width
        // Affects body vertices from gap bottom to gap bottom + taperZone
        const taperZone = 0.20;
        const targetY = leg903MaxY * 1.08; // slightly wider than 903 for overlap
        const yScale = targetY / bodyBottomMaxY;
        for (const sub of bodySubmeshes) {
          for (let vi = sub.vertexStart; vi < sub.vertexStart + sub.vertexCount; vi++) {
            const z = vertexBuffer[vi * 8 + 2];
            if (z >= bodyGapTopZ && z < bodyGapTopZ + taperZone) {
              const t = 1.0 - (z - bodyGapTopZ) / taperZone; // 1.0 at bottom, 0.0 at top
              const scale = 1.0 + (yScale - 1.0) * t;
              vertexBuffer[vi * 8 + 1] *= scale;
            }
          }
        }

        // 2. DROP: push body barrel bottom down to overlap with 903 mid-section
        // This stretches the barrel wall triangles, creating a "skirt" effect
        const dropZone = 0.08;
        const dropAmount = leg903TopZ - bodyGapTopZ + 0.05; // drop past 903 top
        for (const sub of bodySubmeshes) {
          for (let vi = sub.vertexStart; vi < sub.vertexStart + sub.vertexCount; vi++) {
            const z = vertexBuffer[vi * 8 + 2];
            if (z >= bodyGapTopZ && z < bodyGapTopZ + dropZone) {
              const t = 1.0 - (z - bodyGapTopZ) / dropZone;
              vertexBuffer[vi * 8 + 2] += dropAmount * t; // push DOWN (increase Z offset)
            }
          }
        }

        // 3. WIDEN: expand 903 top ring to meet the tapered body
        const legWidenZone = 0.10;
        const legWidenFactor = bodyBottomMaxY > 0 ? targetY / leg903MaxY : 1.15;
        for (const sub of upperLegSubmeshes) {
          for (let vi = sub.vertexStart; vi < sub.vertexStart + sub.vertexCount; vi++) {
            const z = vertexBuffer[vi * 8 + 2];
            if (z > leg903TopZ - legWidenZone) {
              const t = (z - (leg903TopZ - legWidenZone)) / legWidenZone;
              const scale = 1.0 + (legWidenFactor - 1.0) * t * t;
              vertexBuffer[vi * 8 + 1] *= scale;
            }
          }
        }
      }
    }
  }

  const indexBuffer = skin.rawTriangles;

  const groups = skin.submeshes
    .filter(s => s.indexCount > 0 && s.id !== 65535)
    .map(s => ({
      id: s.id,
      indexStart: s.indexStart,
      indexCount: s.indexCount,
    }));

  // Merge bridge mesh into the output if generated
  let finalVertexBuffer: Float32Array;
  let finalIndexBuffer: Uint16Array;
  let finalVertexCount = vertexCount;
  let finalGroups = [...groups];

  if (bridgeVerts && bridgeIndices) {
    const bridgeVertCount = bridgeVerts.length / 8;
    finalVertexCount = vertexCount + bridgeVertCount;
    finalVertexBuffer = new Float32Array(finalVertexCount * 8);
    finalVertexBuffer.set(vertexBuffer);
    finalVertexBuffer.set(bridgeVerts, vertexCount * 8);

    // Offset bridge indices by existing vertex count
    const offsetBridgeIndices = new Uint16Array(bridgeIndices.length);
    for (let i = 0; i < bridgeIndices.length; i++) {
      offsetBridgeIndices[i] = bridgeIndices[i] + vertexCount;
    }

    finalIndexBuffer = new Uint16Array(indexBuffer.length + offsetBridgeIndices.length);
    finalIndexBuffer.set(indexBuffer);
    finalIndexBuffer.set(offsetBridgeIndices, indexBuffer.length);

    // Add bridge as geoset 0 (body mesh) so it renders with body
    finalGroups.push({
      id: 0, // same as body so it's always visible
      indexStart: indexBuffer.length,
      indexCount: offsetBridgeIndices.length,
    });
  } else {
    finalVertexBuffer = vertexBuffer;
    finalIndexBuffer = indexBuffer;
  }

  // Write binary: vertex buffer + index buffer
  const vertexBytes = new Uint8Array(finalVertexBuffer.buffer);
  const indexBytes = new Uint8Array(finalIndexBuffer.buffer);
  const binData = new Uint8Array(vertexBytes.byteLength + indexBytes.byteLength);
  binData.set(vertexBytes, 0);
  binData.set(indexBytes, vertexBytes.byteLength);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outBin, binData);

  const manifest = {
    vertexCount: finalVertexCount,
    indexCount: finalIndexBuffer.length,
    triangleCount: Math.floor(finalIndexBuffer.length / 3),
    vertexBufferSize: vertexBytes.byteLength,
    indexBufferSize: indexBytes.byteLength,
    vertexStride: BROWSER_VERTEX_SIZE,
    groups: finalGroups,
  };
  writeFileSync(outJson, JSON.stringify(manifest, null, 2));

  // Sanity check
  const maxIdx = Math.max(...Array.from(finalIndexBuffer));
  if (maxIdx >= finalVertexCount) {
    console.error(`  ERROR: ${model.slug} index ${maxIdx} out of range (${finalVertexCount} verts)!`);
    process.exit(1);
  }

  return { vertexCount: finalVertexCount, triangleCount: manifest.triangleCount, groupCount: finalGroups.length, binSize: binData.byteLength };
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

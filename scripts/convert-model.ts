/**
 * Convert vanilla M2 (version 256) to web-friendly format with GPU skinning data.
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
 * - public/models/<slug>/model.json (manifest with bones + layout info)
 * - public/models/<slug>/anims.bin  (animation sequences + bone keyframe data)
 *
 * Vertex format (40 bytes per vertex):
 *   position  3×float32  12B  offset 0
 *   normal    3×float32  12B  offset 12
 *   uv        2×float32   8B  offset 24
 *   boneIndices 4×uint8   4B  offset 32
 *   boneWeights 4×uint8   4B  offset 36
 *
 * Vertices are in bind pose (no bone transforms baked in).
 * The renderer applies bone transforms via GPU skinning (THREE.SkinnedMesh).
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
  const globalSequences = arr(off); off += 8;
  const animations = arr(off); off += 8;
  off += 8; // animationLookup
  off += 8; // playableAnimLookup (v256 EXTRA)
  const bones = arr(off); off += 8;
  off += 8; // keyBoneLookup
  const vertices = arr(off); off += 8;
  const views = arr(off); off += 8;

  // Continue parsing header for texture data
  // off is currently at 0x54 (after views)
  off += 8; // colors
  const textures = arr(off); off += 8; // textures (16 bytes each: type u32, flags u32, filename M2Array)
  off += 8; // transparency
  off += 8; // texAnims
  off += 8; // texReplace
  off += 8; // renderFlags
  off += 8; // boneLookup
  const textureLookup = arr(off); off += 8; // textureLookup (uint16 array)

  const nameStr = buf.toString('ascii', name.ofs, name.ofs + name.count).replace(/\0/g, '').trim();

  // Attachments M2Array is at a fixed offset in the header.
  // Offsets (v256 with playableAnimLookup extra):
  //   252 = after: magic(4)+ver(4)+name(8)+globalFlags(4)+globalSeqs(8)+anims(8)+
  //         animLookup(8)+playableAnimLookup(8)+bones(8)+keyBoneLookup(8)+verts(8)+
  //         views(8)+colors(8)+textures(8)+transparency(8)+texAnims(8)+texReplace(8)+
  //         renderFlags(8)+boneLookup(8)+textureLookup(8)+texUnitLookup(8)+
  //         transLookup(8)+uvAnimLookup(8)+boundingBox(24)+boundingRadius(4)+
  //         boundingNormals(8)+boundingVertices(8)+boundingTriangles(8)+
  //         collisionBox(24)+collisionRadius(4) = 252
  const attachmentsArr = arr(252);

  return { nameStr, vertices, views, bones, globalSequences, animations, textures, textureLookup, attachmentsArr, buf, view };
}

// --- View/Skin Parser ---

interface Submesh {
  id: number;
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
}

interface Batch {
  skinSectionIndex: number;
  texComboIndex: number;
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
  const batchesArr = arr(viewOfs + 32);     // batch/texture unit definitions

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

  // Parse batches (24 bytes each for v256)
  // Batch maps submesh → texture via texComboIndex
  const batches: Batch[] = [];
  const BATCH_SIZE = 24;
  for (let b = 0; b < batchesArr.count; b++) {
    const bo = batchesArr.ofs + b * BATCH_SIZE;
    batches.push({
      skinSectionIndex: view.getUint16(bo + 4, true),
      texComboIndex: view.getUint16(bo + 16, true),
    });
  }

  return { remap, rawTriangles, submeshes, batches };
}

// --- Bone Parser ---
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
  parent: number;
  pivot: [number, number, number];
  rotation: [number, number, number, number];
  translation: [number, number, number];
}

function parseBones(view: DataView, bonesArr: M2Arr): BoneData[] {
  function arr(off: number): M2Arr {
    return { count: view.getUint32(off, true), ofs: view.getUint32(off + 4, true) };
  }

  const bones: BoneData[] = [];

  for (let i = 0; i < bonesArr.count; i++) {
    const bo = bonesArr.ofs + i * BONE_SIZE;

    const parent = view.getInt16(bo + 8, true);
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

    bones.push({ parent, pivot, rotation, translation });
  }

  return bones;
}

// --- Sequence Parser ---
//
// M2Sequence for v256 = 68 bytes:
//   animId(u16) + subAnimId(u16) + startTime(u32) + endTime(u32) +
//   moveSpeed(f32) + flags(u32) + frequency(u16) + pad(u16) +
//   repeatMin(u32) + repeatMax(u32) + blendTime(u32) +
//   bounds(M2Bounds=28B) + variationNext(i16) + aliasNext(u16)

const SEQ_SIZE = 68;

interface SequenceData {
  animId: number;
  subAnimId: number;
  startTime: number;
  endTime: number;
  flags: number;
  blendTime: number;
  frequency: number;
  variationNext: number;
  aliasNext: number;
}

function parseSequences(view: DataView, animsArr: M2Arr): SequenceData[] {
  const seqs: SequenceData[] = [];
  for (let i = 0; i < animsArr.count; i++) {
    const so = animsArr.ofs + i * SEQ_SIZE;
    seqs.push({
      animId: view.getUint16(so, true),
      subAnimId: view.getUint16(so + 2, true),
      startTime: view.getUint32(so + 4, true),
      endTime: view.getUint32(so + 8, true),
      flags: view.getUint32(so + 16, true),
      blendTime: view.getUint32(so + 32, true),
      frequency: view.getUint16(so + 20, true),
      variationNext: view.getInt16(so + 64, true),
      aliasNext: view.getUint16(so + 66, true),
    });
  }
  return seqs;
}

// --- Animation Track Extractor ---
//
// Extracts per-bone, per-sequence keyframes from the M2's flat timestamp/value arrays.
// M2 v256 stores bone animations with global timestamps spanning all sequences.
// The "ranges" array (nSeq+1 entries) maps each sequence to a [startIdx, endIdx] slice
// of the flat timestamps/values arrays. Timestamps are normalized to local time.

interface BoneTrackMeta {
  transInterp: number;
  rotInterp: number;
  scaleInterp: number;
  transGlobalSeq: number;
  rotGlobalSeq: number;
  scaleGlobalSeq: number;
}

interface BoneSeqKeyframes {
  transTimestamps: number[];
  transValues: number[];    // flat xyz triplets
  rotTimestamps: number[];
  rotValues: number[];      // flat xyzw quads
  scaleTimestamps: number[];
  scaleValues: number[];    // flat xyz triplets
  transIsLocal?: boolean;   // timestamps already in local time (global seq)
  rotIsLocal?: boolean;
  scaleIsLocal?: boolean;
}

function parseBoneAnimations(
  view: DataView,
  bonesArr: M2Arr,
  nSeq: number,
): { trackMeta: BoneTrackMeta[]; perBoneSeq: BoneSeqKeyframes[][] } {
  function arr(off: number): M2Arr {
    return { count: view.getUint32(off, true), ofs: view.getUint32(off + 4, true) };
  }

  const trackMeta: BoneTrackMeta[] = [];
  const perBoneSeq: BoneSeqKeyframes[][] = [];

  for (let b = 0; b < bonesArr.count; b++) {
    const bo = bonesArr.ofs + b * BONE_SIZE;

    // Track metadata
    const transInterp = view.getUint16(bo + 12, true);
    const transGlobalSeq = view.getInt16(bo + 14, true);
    const rotInterp = view.getUint16(bo + 40, true);
    const rotGlobalSeq = view.getInt16(bo + 42, true);
    const scaleInterp = view.getUint16(bo + 68, true);
    const scaleGlobalSeq = view.getInt16(bo + 70, true);

    trackMeta.push({ transInterp, rotInterp, scaleInterp, transGlobalSeq, rotGlobalSeq, scaleGlobalSeq });

    // Parse flat arrays for each track
    const transRanges = arr(bo + 16);
    const transTs = arr(bo + 24);
    const transVals = arr(bo + 32);

    const rotRanges = arr(bo + 44);
    const rotTs = arr(bo + 52);
    const rotVals = arr(bo + 60);

    const scaleRanges = arr(bo + 72);
    const scaleTs = arr(bo + 80);
    const scaleVals = arr(bo + 88);

    const boneSeqs: BoneSeqKeyframes[] = [];

    // Helper to extract keyframes for a range-indexed track
    function extractRanged(
      ranges: M2Arr, ts: M2Arr, vals: M2Arr,
      seqIdx: number, valSize: number, valsPerKf: number,
      outTs: number[], outVals: number[],
    ) {
      if (seqIdx >= ranges.count || ts.count === 0) return;
      const rangeStart = view.getUint32(ranges.ofs + seqIdx * 8, true);
      const rangeEnd = view.getUint32(ranges.ofs + seqIdx * 8 + 4, true);
      if (rangeEnd >= ts.count) return;
      for (let k = rangeStart; k <= rangeEnd; k++) {
        outTs.push(view.getUint32(ts.ofs + k * 4, true));
        const vo = vals.ofs + k * valSize;
        for (let v = 0; v < valsPerKf; v++) {
          outVals.push(view.getFloat32(vo + v * 4, true));
        }
      }
    }

    // Helper to extract ALL keyframes from a flat track (for global sequences with no ranges)
    function extractFlat(
      ts: M2Arr, vals: M2Arr,
      valSize: number, valsPerKf: number,
      outTs: number[], outVals: number[],
    ) {
      for (let k = 0; k < ts.count; k++) {
        outTs.push(view.getUint32(ts.ofs + k * 4, true));
        const vo = vals.ofs + k * valSize;
        for (let v = 0; v < valsPerKf; v++) {
          outVals.push(view.getFloat32(vo + v * 4, true));
        }
      }
    }

    for (let s = 0; s < nSeq; s++) {
      const kf: BoneSeqKeyframes = {
        transTimestamps: [], transValues: [],
        rotTimestamps: [], rotValues: [],
        scaleTimestamps: [], scaleValues: [],
      };

      // For global seq tracks with no ranges, store all keyframes at seq 0
      // (timestamps are already in [0, gsDuration] local time)
      if (s === 0) {
        if (transGlobalSeq >= 0 && transRanges.count === 0 && transTs.count > 0) {
          extractFlat(transTs, transVals, 12, 3, kf.transTimestamps, kf.transValues);
          kf.transIsLocal = true;
        }
        if (rotGlobalSeq >= 0 && rotRanges.count === 0 && rotTs.count > 0) {
          extractFlat(rotTs, rotVals, 16, 4, kf.rotTimestamps, kf.rotValues);
          kf.rotIsLocal = true;
        }
        if (scaleGlobalSeq >= 0 && scaleRanges.count === 0 && scaleTs.count > 0) {
          extractFlat(scaleTs, scaleVals, 12, 3, kf.scaleTimestamps, kf.scaleValues);
          kf.scaleIsLocal = true;
        }
      }

      // Normal range-based extraction (for non-global-seq tracks, or global-seq tracks WITH ranges)
      if (transGlobalSeq < 0 || transRanges.count > 0) {
        extractRanged(transRanges, transTs, transVals, s, 12, 3, kf.transTimestamps, kf.transValues);
      }
      if (rotGlobalSeq < 0 || rotRanges.count > 0) {
        extractRanged(rotRanges, rotTs, rotVals, s, 16, 4, kf.rotTimestamps, kf.rotValues);
      }
      if (scaleGlobalSeq < 0 || scaleRanges.count > 0) {
        extractRanged(scaleRanges, scaleTs, scaleVals, s, 12, 3, kf.scaleTimestamps, kf.scaleValues);
      }

      boneSeqs.push(kf);
    }

    perBoneSeq.push(boneSeqs);
  }

  return { trackMeta, perBoneSeq };
}

// --- anims.bin Writer ---
//
// Binary format:
//   Header (28B): magic "ANIM", version u16, boneCount u16, seqCount u16,
//                 gsCount u16, seqTableOfs u32, gsTableOfs u32,
//                 boneTableOfs u32, indexOfs u32
//   SequenceTable (20B each): animId u16, subAnimId u16, duration u32,
//                 flags u32, blendTime u16, frequency u16,
//                 variationNext i16, aliasNext i16
//   GlobalSeqTable (4B each): duration u32
//   BoneTrackTable (8B each): transInterp u8, rotInterp u8, scaleInterp u8,
//                 transGlobalSeq i8, rotGlobalSeq i8, scaleGlobalSeq i8, pad u16
//   BoneSeqIndex (6B each, [bone*nSeq+seq]): transCount u16, rotCount u16, scaleCount u16
//   KeyframeData (variable): per (bone,seq) in index order:
//     Translation: [u16 timestamp, f32[3] xyz] × transCount  (14B each)
//     Rotation:    [u16 timestamp, f32[4] xyzw] × rotCount   (18B each)
//     Scale:       [u16 timestamp, f32[3] xyz] × scaleCount  (14B each)

function writeAnimsBin(
  outPath: string,
  sequences: SequenceData[],
  globalSeqDurations: number[],
  trackMeta: BoneTrackMeta[],
  perBoneSeq: BoneSeqKeyframes[][],
): number {
  const nBones = trackMeta.length;
  const nSeq = sequences.length;
  const nGs = globalSeqDurations.length;

  const HEADER_SIZE = 28;
  const SEQ_ENTRY_SIZE = 20;
  const GS_ENTRY_SIZE = 4;
  const BONE_ENTRY_SIZE = 8;
  const INDEX_ENTRY_SIZE = 6;
  const TRANS_KF_SIZE = 14;  // u16 + 3×f32
  const ROT_KF_SIZE = 18;    // u16 + 4×f32
  const SCALE_KF_SIZE = 14;  // u16 + 3×f32

  const seqTableOfs = HEADER_SIZE;
  const gsTableOfs = seqTableOfs + nSeq * SEQ_ENTRY_SIZE;
  const boneTableOfs = gsTableOfs + nGs * GS_ENTRY_SIZE;
  const indexOfs = boneTableOfs + nBones * BONE_ENTRY_SIZE;

  // Calculate keyframe data size
  let kfDataSize = 0;
  for (let b = 0; b < nBones; b++) {
    for (let s = 0; s < nSeq; s++) {
      const kf = perBoneSeq[b][s];
      kfDataSize += kf.transTimestamps.length * TRANS_KF_SIZE;
      kfDataSize += kf.rotTimestamps.length * ROT_KF_SIZE;
      kfDataSize += kf.scaleTimestamps.length * SCALE_KF_SIZE;
    }
  }

  const kfDataOfs = indexOfs + nBones * nSeq * INDEX_ENTRY_SIZE;
  const totalSize = kfDataOfs + kfDataSize;

  const buf = Buffer.alloc(totalSize);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Header
  buf.write('ANIM', 0, 'ascii');
  dv.setUint16(4, 1, true);         // version
  dv.setUint16(6, nBones, true);
  dv.setUint16(8, nSeq, true);
  dv.setUint16(10, nGs, true);
  dv.setUint32(12, seqTableOfs, true);
  dv.setUint32(16, gsTableOfs, true);
  dv.setUint32(20, boneTableOfs, true);
  dv.setUint32(24, indexOfs, true);

  // Sequence table
  for (let s = 0; s < nSeq; s++) {
    const seq = sequences[s];
    const o = seqTableOfs + s * SEQ_ENTRY_SIZE;
    const duration = seq.endTime - seq.startTime;
    dv.setUint16(o, seq.animId, true);
    dv.setUint16(o + 2, seq.subAnimId, true);
    dv.setUint32(o + 4, duration, true);
    dv.setUint32(o + 8, seq.flags, true);
    dv.setUint16(o + 12, seq.blendTime, true);
    dv.setUint16(o + 14, seq.frequency, true);
    dv.setInt16(o + 16, seq.variationNext, true);
    dv.setInt16(o + 18, seq.aliasNext, true);
  }

  // Global sequence table
  for (let g = 0; g < nGs; g++) {
    dv.setUint32(gsTableOfs + g * GS_ENTRY_SIZE, globalSeqDurations[g], true);
  }

  // Bone track table
  for (let b = 0; b < nBones; b++) {
    const o = boneTableOfs + b * BONE_ENTRY_SIZE;
    const tm = trackMeta[b];
    dv.setUint8(o, tm.transInterp);
    dv.setUint8(o + 1, tm.rotInterp);
    dv.setUint8(o + 2, tm.scaleInterp);
    dv.setInt8(o + 3, tm.transGlobalSeq);
    dv.setInt8(o + 4, tm.rotGlobalSeq);
    dv.setInt8(o + 5, tm.scaleGlobalSeq);
    dv.setUint16(o + 6, 0, true); // pad
  }

  // Bone-seq index + keyframe data
  let kfOfs = kfDataOfs;
  for (let b = 0; b < nBones; b++) {
    for (let s = 0; s < nSeq; s++) {
      const idxOfs = indexOfs + (b * nSeq + s) * INDEX_ENTRY_SIZE;
      const kf = perBoneSeq[b][s];
      const startTime = sequences[s].startTime;

      dv.setUint16(idxOfs, kf.transTimestamps.length, true);
      dv.setUint16(idxOfs + 2, kf.rotTimestamps.length, true);
      dv.setUint16(idxOfs + 4, kf.scaleTimestamps.length, true);

      // Translation keyframes
      const transOffset = kf.transIsLocal ? 0 : startTime;
      for (let k = 0; k < kf.transTimestamps.length; k++) {
        const localTs = kf.transTimestamps[k] - transOffset;
        dv.setUint16(kfOfs, Math.max(0, localTs), true);
        dv.setFloat32(kfOfs + 2, kf.transValues[k * 3], true);
        dv.setFloat32(kfOfs + 6, kf.transValues[k * 3 + 1], true);
        dv.setFloat32(kfOfs + 10, kf.transValues[k * 3 + 2], true);
        kfOfs += TRANS_KF_SIZE;
      }

      // Rotation keyframes
      const rotOffset = kf.rotIsLocal ? 0 : startTime;
      for (let k = 0; k < kf.rotTimestamps.length; k++) {
        const localTs = kf.rotTimestamps[k] - rotOffset;
        dv.setUint16(kfOfs, Math.max(0, localTs), true);
        dv.setFloat32(kfOfs + 2, kf.rotValues[k * 4], true);
        dv.setFloat32(kfOfs + 6, kf.rotValues[k * 4 + 1], true);
        dv.setFloat32(kfOfs + 10, kf.rotValues[k * 4 + 2], true);
        dv.setFloat32(kfOfs + 14, kf.rotValues[k * 4 + 3], true);
        kfOfs += ROT_KF_SIZE;
      }

      // Scale keyframes
      const scaleOffset = kf.scaleIsLocal ? 0 : startTime;
      for (let k = 0; k < kf.scaleTimestamps.length; k++) {
        const localTs = kf.scaleTimestamps[k] - scaleOffset;
        dv.setUint16(kfOfs, Math.max(0, localTs), true);
        dv.setFloat32(kfOfs + 2, kf.scaleValues[k * 3], true);
        dv.setFloat32(kfOfs + 6, kf.scaleValues[k * 3 + 1], true);
        dv.setFloat32(kfOfs + 10, kf.scaleValues[k * 3 + 2], true);
        kfOfs += SCALE_KF_SIZE;
      }
    }
  }

  writeFileSync(outPath, buf);
  return totalSize;
}

// --- Convert a single model ---

const VERTEX_STRIDE = 40; // bytes per vertex

function convertModel(model: CharacterModel) {
  const m2FullPath = resolve(ROOT, model.m2Path);
  const outDir = resolve(ROOT, 'public/models', model.slug);
  const outBin = resolve(outDir, 'model.bin');
  const outJson = resolve(outDir, 'model.json');
  const outAnims = resolve(outDir, 'anims.bin');

  const buf = readFileSync(m2FullPath);
  const m2 = parseM2v256(buf);
  const skin = parseView0(buf, m2.view, m2.views);
  const bones = parseBones(m2.view, m2.bones);

  // Parse animation data
  const sequences = parseSequences(m2.view, m2.animations);
  const globalSeqDurations: number[] = [];
  for (let g = 0; g < m2.globalSequences.count; g++) {
    globalSeqDurations.push(m2.view.getUint32(m2.globalSequences.ofs + g * 4, true));
  }
  const { trackMeta, perBoneSeq } = parseBoneAnimations(m2.view, m2.bones, sequences.length);

  // Parse texture table (16 bytes each: type u32, flags u32, filename M2Array 8B)
  const TEX_DEF_SIZE = 16;
  const texTypes: number[] = [];
  for (let t = 0; t < m2.textures.count; t++) {
    const to = m2.textures.ofs + t * TEX_DEF_SIZE;
    texTypes.push(m2.view.getUint32(to, true)); // texture type at offset 0
  }

  // Parse texture lookup table (uint16 array)
  const texLookup: number[] = [];
  for (let t = 0; t < m2.textureLookup.count; t++) {
    texLookup.push(m2.view.getUint16(m2.textureLookup.ofs + t * 2, true));
  }

  // Parse attachment points from header offset 252
  // Attachment struct (48 bytes): id(u32) + bone(u16) + unk(u16) + pos(f32×3) + animTrack(28B)
  const WANTED_ATTACHMENT_IDS = new Set([1, 2, 5, 6, 11]); // HandRight, HandLeft, ShoulderR, ShoulderL, Head
  const ATTACHMENT_STRUCT_SIZE = 48;
  interface AttachmentPoint { id: number; bone: number; pos: [number, number, number]; }
  const attachments: AttachmentPoint[] = [];
  for (let i = 0; i < m2.attachmentsArr.count; i++) {
    const ao = m2.attachmentsArr.ofs + i * ATTACHMENT_STRUCT_SIZE;
    const id = m2.view.getUint32(ao, true);
    if (!WANTED_ATTACHMENT_IDS.has(id)) continue;
    const bone = m2.view.getUint16(ao + 4, true);
    if (bone >= bones.length) continue; // sanity check
    const pos: [number, number, number] = [
      m2.view.getFloat32(ao + 8, true),
      m2.view.getFloat32(ao + 12, true),
      m2.view.getFloat32(ao + 16, true),
    ];
    if (Math.abs(pos[0]) > 10 || Math.abs(pos[1]) > 10 || Math.abs(pos[2]) > 10) continue;
    attachments.push({ id, bone, pos });
  }

  // Build submesh index → texture type mapping via batch chain:
  // batch.texComboIndex → texLookup[i] → texTypes[j]
  const submeshTexType = new Map<number, number>();
  for (const batch of skin.batches) {
    const si = batch.skinSectionIndex;
    if (submeshTexType.has(si)) continue; // first batch wins
    const lookupIdx = batch.texComboIndex;
    if (lookupIdx < texLookup.length) {
      const texIdx = texLookup[lookupIdx];
      if (texIdx < texTypes.length) {
        submeshTexType.set(si, texTypes[texIdx]);
      }
    }
  }

  // Build output vertex buffer — raw bind-pose vertices with skinning data.
  // M2 vertex (48 bytes): pos(3f) boneWeights(4u8) boneIndices(4u8) normal(3f) uv1(2f) uv2(2f)
  // Output (40 bytes): pos(3f) normal(3f) uv(2f) boneIndices(4u8) boneWeights(4u8)
  const vertexCount = skin.remap.length;
  const outBuf = new ArrayBuffer(vertexCount * VERTEX_STRIDE);
  const f32 = new Float32Array(outBuf);
  const u8 = new Uint8Array(outBuf);

  // Stride in float32 units = 40/4 = 10
  const STRIDE_F32 = VERTEX_STRIDE / 4;

  for (let i = 0; i < vertexCount; i++) {
    const modelIdx = skin.remap[i];
    const srcOfs = m2.vertices.ofs + modelIdx * 48;

    // Position (M2 offset 0)
    f32[i * STRIDE_F32 + 0] = m2.view.getFloat32(srcOfs + 0, true);
    f32[i * STRIDE_F32 + 1] = m2.view.getFloat32(srcOfs + 4, true);
    f32[i * STRIDE_F32 + 2] = m2.view.getFloat32(srcOfs + 8, true);

    // Normal (M2 offset 20)
    f32[i * STRIDE_F32 + 3] = m2.view.getFloat32(srcOfs + 20, true);
    f32[i * STRIDE_F32 + 4] = m2.view.getFloat32(srcOfs + 24, true);
    f32[i * STRIDE_F32 + 5] = m2.view.getFloat32(srcOfs + 28, true);

    // UV (M2 offset 32)
    f32[i * STRIDE_F32 + 6] = m2.view.getFloat32(srcOfs + 32, true);
    f32[i * STRIDE_F32 + 7] = m2.view.getFloat32(srcOfs + 36, true);

    // Bone indices (M2 offset 16, 4 × uint8) → output byte offset 32
    const byteBase = i * VERTEX_STRIDE;
    u8[byteBase + 32] = buf[srcOfs + 16];
    u8[byteBase + 33] = buf[srcOfs + 17];
    u8[byteBase + 34] = buf[srcOfs + 18];
    u8[byteBase + 35] = buf[srcOfs + 19];

    // Bone weights (M2 offset 12, 4 × uint8) → output byte offset 36
    u8[byteBase + 36] = buf[srcOfs + 12];
    u8[byteBase + 37] = buf[srcOfs + 13];
    u8[byteBase + 38] = buf[srcOfs + 14];
    u8[byteBase + 39] = buf[srcOfs + 15];
  }

  let groups = skin.submeshes
    .map((s, origIdx) => ({ ...s, origIdx }))
    .filter(s => s.indexCount > 0 && s.id !== 65535)
    .map(s => ({
      id: s.id,
      indexStart: s.indexStart,
      indexCount: s.indexCount,
      textureType: submeshTexType.get(s.origIdx) ?? -1,
    }));

  const indexBuffer = skin.rawTriangles;

  // Write binary: vertex buffer + index buffer
  const vertexBytes = new Uint8Array(outBuf);
  const indexBytes = new Uint8Array(indexBuffer.buffer, indexBuffer.byteOffset, indexBuffer.byteLength);
  const binData = new Uint8Array(vertexBytes.byteLength + indexBytes.byteLength);
  binData.set(vertexBytes, 0);
  binData.set(indexBytes, vertexBytes.byteLength);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outBin, binData);

  // Write animation data
  const animBinSize = writeAnimsBin(outAnims, sequences, globalSeqDurations, trackMeta, perBoneSeq);

  const manifest = {
    vertexCount,
    indexCount: indexBuffer.length,
    triangleCount: Math.floor(indexBuffer.length / 3),
    vertexBufferSize: vertexBytes.byteLength,
    indexBufferSize: indexBytes.byteLength,
    vertexStride: VERTEX_STRIDE,
    bones: bones.map(b => ({
      parent: b.parent,
      pivot: b.pivot,
      rotation: b.rotation,
      translation: b.translation,
    })),
    groups,
    attachments,
  };
  writeFileSync(outJson, JSON.stringify(manifest, null, 2));

  // Sanity check
  const maxIdx = Math.max(...Array.from(indexBuffer));
  if (maxIdx >= vertexCount) {
    console.error(`  ERROR: ${model.slug} index ${maxIdx} out of range (${vertexCount} verts)!`);
    process.exit(1);
  }

  return { vertexCount, triangleCount: manifest.triangleCount, groupCount: groups.length, boneCount: bones.length, attachmentCount: attachments.length, binSize: binData.byteLength, seqCount: sequences.length, animBinSize };
}

// --- Main ---

function main() {
  console.log(`Converting ${CHARACTER_MODELS.length} character models...\n`);

  let totalModels = 0;
  let totalTris = 0;

  for (const model of CHARACTER_MODELS) {
    const result = convertModel(model);
    console.log(`${model.slug}: ${result.vertexCount} verts, ${result.triangleCount} tris, ${result.groupCount} groups, ${result.boneCount} bones, ${result.attachmentCount} attachments, ${result.seqCount} seqs, ${result.binSize}B model, ${result.animBinSize}B anims`);
    totalModels++;
    totalTris += result.triangleCount;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Models converted: ${totalModels}`);
  console.log(`Total triangles: ${totalTris}`);
}

main();

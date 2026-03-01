import * as THREE from 'three';

// --- anims.bin Parser ---

interface SequenceInfo {
  animId: number;
  subAnimId: number;
  duration: number;
  flags: number;
  blendTime: number;
  frequency: number;
  variationNext: number;
  aliasNext: number;
}

interface BoneTrackInfo {
  transInterp: number;
  rotInterp: number;
  scaleInterp: number;
  transGlobalSeq: number;
  rotGlobalSeq: number;
  scaleGlobalSeq: number;
}

interface AnimData {
  sequences: SequenceInfo[];
  globalSeqDurations: number[];
  boneTracks: BoneTrackInfo[];
  boneCount: number;
  seqCount: number;
  // Raw DataView + offsets for keyframe random access
  view: DataView;
  indexOfs: number;
}

export async function loadAnimations(modelDir: string): Promise<AnimData> {
  const res = await fetch(`${modelDir}/anims.bin`);
  if (!res.ok) throw new Error(`Failed to fetch ${modelDir}/anims.bin: ${res.status}`);
  const buf = await res.arrayBuffer();
  const view = new DataView(buf);

  // Header (28 bytes)
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'ANIM') throw new Error(`Bad anims.bin magic: ${magic}`);

  const boneCount = view.getUint16(6, true);
  const seqCount = view.getUint16(8, true);
  const gsCount = view.getUint16(10, true);
  const seqTableOfs = view.getUint32(12, true);
  const gsTableOfs = view.getUint32(16, true);
  const boneTableOfs = view.getUint32(20, true);
  const indexOfs = view.getUint32(24, true);

  // Sequence table (20 bytes each)
  const sequences: SequenceInfo[] = [];
  for (let s = 0; s < seqCount; s++) {
    const o = seqTableOfs + s * 20;
    sequences.push({
      animId: view.getUint16(o, true),
      subAnimId: view.getUint16(o + 2, true),
      duration: view.getUint32(o + 4, true),
      flags: view.getUint32(o + 8, true),
      blendTime: view.getUint16(o + 12, true),
      frequency: view.getUint16(o + 14, true),
      variationNext: view.getInt16(o + 16, true),
      aliasNext: view.getInt16(o + 18, true),
    });
  }

  // Global sequence durations
  const globalSeqDurations: number[] = [];
  for (let g = 0; g < gsCount; g++) {
    globalSeqDurations.push(view.getUint32(gsTableOfs + g * 4, true));
  }

  // Bone track info (8 bytes each)
  const boneTracks: BoneTrackInfo[] = [];
  for (let b = 0; b < boneCount; b++) {
    const o = boneTableOfs + b * 8;
    boneTracks.push({
      transInterp: view.getUint8(o),
      rotInterp: view.getUint8(o + 1),
      scaleInterp: view.getUint8(o + 2),
      transGlobalSeq: view.getInt8(o + 3),
      rotGlobalSeq: view.getInt8(o + 4),
      scaleGlobalSeq: view.getInt8(o + 5),
    });
  }

  return { sequences, globalSeqDurations, boneTracks, boneCount, seqCount, view, indexOfs };
}

// --- Keyframe Access ---
// The BoneSeqIndex table at indexOfs has 6 bytes per (bone, seq):
//   transCount u16, rotCount u16, scaleCount u16
// Keyframe data follows in index order:
//   Translation: [u16 ts, f32[3] xyz] × transCount  (14B each)
//   Rotation:    [u16 ts, f32[4] xyzw] × rotCount   (18B each)
//   Scale:       [u16 ts, f32[3] xyz] × scaleCount   (14B each)

// Precompute cumulative byte offsets for random access into keyframe data
function buildKfOffsetTable(anim: AnimData): Uint32Array {
  const n = anim.boneCount * anim.seqCount;
  const offsets = new Uint32Array(n);
  const indexBase = anim.indexOfs;
  const kfDataStart = indexBase + n * 6;
  let cursor = kfDataStart;

  for (let i = 0; i < n; i++) {
    offsets[i] = cursor;
    const idxOfs = indexBase + i * 6;
    const tC = anim.view.getUint16(idxOfs, true);
    const rC = anim.view.getUint16(idxOfs + 2, true);
    const sC = anim.view.getUint16(idxOfs + 4, true);
    cursor += tC * 14 + rC * 18 + sC * 14;
  }

  return offsets;
}

// --- Interpolation Helpers ---

function lerpVec3(out: Float32Array, outOfs: number, a: DataView, aOfs: number, b: DataView, bOfs: number, t: number) {
  out[outOfs]     = a.getFloat32(aOfs, true)     + t * (b.getFloat32(bOfs, true)     - a.getFloat32(aOfs, true));
  out[outOfs + 1] = a.getFloat32(aOfs + 4, true) + t * (b.getFloat32(bOfs + 4, true) - a.getFloat32(aOfs + 4, true));
  out[outOfs + 2] = a.getFloat32(aOfs + 8, true) + t * (b.getFloat32(bOfs + 8, true) - a.getFloat32(aOfs + 8, true));
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

function slerpQuat(out: THREE.Quaternion, view: DataView, aOfs: number, bOfs: number, t: number) {
  _qa.set(
    view.getFloat32(aOfs, true),
    view.getFloat32(aOfs + 4, true),
    view.getFloat32(aOfs + 8, true),
    view.getFloat32(aOfs + 12, true),
  );
  _qb.set(
    view.getFloat32(bOfs, true),
    view.getFloat32(bOfs + 4, true),
    view.getFloat32(bOfs + 8, true),
    view.getFloat32(bOfs + 12, true),
  );
  // Shortest-path: negate if dot < 0
  if (_qa.dot(_qb) < 0) {
    _qb.set(-_qb.x, -_qb.y, -_qb.z, -_qb.w);
  }
  out.slerpQuaternions(_qa, _qb, t);
}

// Binary search for the keyframe pair bracketing `time`
// Returns the index of the keyframe at or before `time`
function findKeyframe(view: DataView, baseOfs: number, count: number, stride: number, time: number): number {
  if (count <= 1) return 0;
  // Time is stored as u16 at the start of each keyframe
  let lo = 0;
  let hi = count - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    const ts = view.getUint16(baseOfs + mid * stride, true);
    if (ts <= time) lo = mid;
    else hi = mid;
  }
  return lo;
}

// --- Animation Controller ---

export interface BoneInfo {
  parent: number;
  pivot: [number, number, number];
  rotation: [number, number, number, number];
  translation: [number, number, number];
}

// Static map of common animation names from AnimationData.dbc
const ANIM_NAMES: Record<number, string> = {
  0: 'Stand', 1: 'Death', 2: 'Spell', 3: 'Stop', 4: 'Walk', 5: 'Run',
  6: 'Dead', 7: 'Rise', 8: 'StandWound', 9: 'CombatWound', 10: 'CombatCritical',
  11: 'ShuffleLeft', 12: 'ShuffleRight', 13: 'Walkbackwards', 14: 'Stun',
  15: 'HandsClosed', 16: 'AttackUnarmed', 17: 'Attack1H', 18: 'Attack2H',
  20: 'ParryUnarmed', 21: 'Parry1H', 24: 'ShieldBlock',
  25: 'ReadyUnarmed', 26: 'Ready1H', 27: 'Ready2H', 28: 'Ready2HL',
  29: 'ReadyBow', 30: 'Dodge', 31: 'SpellPrecast', 32: 'SpellCast',
  37: 'JumpStart', 38: 'Jump', 39: 'JumpEnd', 40: 'Fall',
  41: 'SwimIdle', 42: 'Swim', 46: 'AttackBow',
  50: 'Loot', 55: 'BattleRoar', 60: 'EmoteTalk', 61: 'EmoteEat',
  66: 'EmoteBow', 67: 'EmoteWave', 68: 'EmoteCheer', 69: 'EmoteDance',
  70: 'EmoteLaugh', 71: 'EmoteSleep', 72: 'EmoteSitGround',
  73: 'EmoteRude', 74: 'EmoteRoar', 75: 'EmoteKneel', 76: 'EmoteKiss',
  77: 'EmoteCry', 78: 'EmoteChicken', 79: 'EmoteBeg', 80: 'EmoteApplaud',
  81: 'EmoteShout', 82: 'EmoteFlex', 83: 'EmoteShy', 84: 'EmotePoint',
  89: 'Sheath', 91: 'Mount', 95: 'Kick', 113: 'EmoteSalute',
  119: 'StealthWalk', 120: 'StealthStand', 126: 'Whirlwind', 127: 'Birth',
  130: 'CreatureSpecial', 133: 'FishingCast', 134: 'FishingLoop',
  137: 'EmoteStunNoSheathe', 143: 'Sprint',
};

export class AnimationController {
  private anim: AnimData;
  private boneData: BoneInfo[];
  private bones: THREE.Bone[];
  private kfOffsets: Uint32Array;
  private seqIndex: number = 0;
  private localTime: number = 0;
  private globalSeqTimers: Float64Array;
  private playing: boolean = true;

  // Reusable temp objects
  private _trans = new Float32Array(3);
  private _scale = new Float32Array(3);
  private _quat = new THREE.Quaternion();
  private _matT = new THREE.Matrix4();
  private _matR = new THREE.Matrix4();
  private _matNP = new THREE.Matrix4();

  constructor(anim: AnimData, boneData: BoneInfo[], bones: THREE.Bone[]) {
    this.anim = anim;
    this.boneData = boneData;
    this.bones = bones;
    this.kfOffsets = buildKfOffsetTable(anim);
    this.globalSeqTimers = new Float64Array(anim.globalSeqDurations.length);
  }

  setSequence(seqIndex: number) {
    this.seqIndex = seqIndex;
    this.localTime = 0;
  }

  getAnimationList(): Array<{ seqIndex: number; label: string; animId: number; subAnimId: number; duration: number }> {
    return this.anim.sequences.map((seq, i) => {
      const baseName = ANIM_NAMES[seq.animId] ?? `Anim_${seq.animId}`;
      const label = seq.subAnimId > 0 ? `${baseName} (${seq.subAnimId})` : baseName;
      return { seqIndex: i, label, animId: seq.animId, subAnimId: seq.subAnimId, duration: seq.duration };
    });
  }

  update(deltaMs: number) {
    if (!this.playing) return;

    const seq = this.anim.sequences[this.seqIndex];
    const duration = seq.duration;

    // Advance time, loop
    if (duration > 0) {
      this.localTime = (this.localTime + deltaMs) % duration;
    }

    // Advance global sequence timers
    for (let g = 0; g < this.globalSeqTimers.length; g++) {
      const gsDur = this.anim.globalSeqDurations[g];
      if (gsDur > 0) {
        this.globalSeqTimers[g] = (this.globalSeqTimers[g] + deltaMs) % gsDur;
      }
    }

    const view = this.anim.view;
    const indexBase = this.anim.indexOfs;
    const nSeq = this.anim.seqCount;
    const seqIdx = this.seqIndex;
    const time = this.localTime;

    for (let b = 0; b < this.anim.boneCount; b++) {
      const bone = this.bones[b];
      if (!bone) continue;
      const bd = this.boneData[b];
      const bt = this.anim.boneTracks[b];

      // Determine which sequence index to sample for each track
      // (global sequence bones ignore the active sequence)
      const transSeq = bt.transGlobalSeq >= 0 ? 0 : seqIdx;
      const rotSeq = bt.rotGlobalSeq >= 0 ? 0 : seqIdx;
      const scaleSeq = bt.scaleGlobalSeq >= 0 ? 0 : seqIdx;

      const transTime = bt.transGlobalSeq >= 0 ? this.globalSeqTimers[bt.transGlobalSeq] : time;
      const rotTime = bt.rotGlobalSeq >= 0 ? this.globalSeqTimers[bt.rotGlobalSeq] : time;
      const scaleTime = bt.scaleGlobalSeq >= 0 ? this.globalSeqTimers[bt.scaleGlobalSeq] : time;

      // Read bone-seq index entries
      const transIdxOfs = indexBase + (b * nSeq + transSeq) * 6;
      const rotIdxOfs = indexBase + (b * nSeq + rotSeq) * 6;
      const scaleIdxOfs = indexBase + (b * nSeq + scaleSeq) * 6;

      const transCount = view.getUint16(transIdxOfs, true);
      const rotCount = view.getUint16(rotIdxOfs + 2, true);
      const scaleCount = view.getUint16(scaleIdxOfs + 4, true);

      // Get keyframe data offsets
      const transKfBase = this.kfOffsets[b * nSeq + transSeq];

      // Sample translation
      this._trans[0] = bd.translation[0];
      this._trans[1] = bd.translation[1];
      this._trans[2] = bd.translation[2];

      if (transCount > 0 && bt.transInterp > 0) {
        this.sampleVec3(view, transKfBase, transCount, 14, transTime, this._trans, 0);
      }

      // Sample rotation
      this._quat.set(bd.rotation[0], bd.rotation[1], bd.rotation[2], bd.rotation[3]);

      if (rotCount > 0 && bt.rotInterp > 0) {
        // Rotation keyframe data starts after translation data
        // For the active sequence, we need proper offset calculation
        const actualRotBase = this.kfOffsets[b * nSeq + rotSeq] +
          view.getUint16(indexBase + (b * nSeq + rotSeq) * 6, true) * 14;
        this.sampleQuat(view, actualRotBase, rotCount, 18, rotTime, this._quat);
      }

      // Sample scale
      this._scale[0] = 1;
      this._scale[1] = 1;
      this._scale[2] = 1;

      if (scaleCount > 0 && bt.scaleInterp > 0) {
        const actualScaleBase = this.kfOffsets[b * nSeq + scaleSeq] +
          view.getUint16(indexBase + (b * nSeq + scaleSeq) * 6, true) * 14 +
          view.getUint16(indexBase + (b * nSeq + scaleSeq) * 6 + 2, true) * 18;
        this.sampleVec3(view, actualScaleBase, scaleCount, 14, scaleTime, this._scale, 0);
      }

      // Compose bone matrix: T(pivot + trans) * R(rot) * S(scale) * T(-pivot)
      const px = bd.pivot[0], py = bd.pivot[1], pz = bd.pivot[2];

      this._matNP.makeTranslation(-px, -py, -pz);
      this._matR.makeRotationFromQuaternion(this._quat);

      // Apply scale if non-identity
      if (this._scale[0] !== 1 || this._scale[1] !== 1 || this._scale[2] !== 1) {
        this._matR.scale(new THREE.Vector3(this._scale[0], this._scale[1], this._scale[2]));
      }

      this._matT.makeTranslation(
        px + this._trans[0],
        py + this._trans[1],
        pz + this._trans[2],
      );

      bone.matrix.copy(this._matT).multiply(this._matR).multiply(this._matNP);
    }
  }

  private sampleVec3(view: DataView, base: number, count: number, stride: number, time: number, out: Float32Array, outOfs: number) {
    if (count === 1) {
      out[outOfs]     = view.getFloat32(base + 2, true);
      out[outOfs + 1] = view.getFloat32(base + 6, true);
      out[outOfs + 2] = view.getFloat32(base + 10, true);
      return;
    }

    const idx = findKeyframe(view, base, count, stride, time);
    const ts0 = view.getUint16(base + idx * stride, true);
    const nextIdx = idx + 1;

    if (nextIdx >= count) {
      // Past last keyframe — use last value
      const o = base + idx * stride + 2;
      out[outOfs]     = view.getFloat32(o, true);
      out[outOfs + 1] = view.getFloat32(o + 4, true);
      out[outOfs + 2] = view.getFloat32(o + 8, true);
      return;
    }

    const ts1 = view.getUint16(base + nextIdx * stride, true);
    const dt = ts1 - ts0;
    const t = dt > 0 ? (time - ts0) / dt : 0;

    lerpVec3(out, outOfs, view, base + idx * stride + 2, view, base + nextIdx * stride + 2, t);
  }

  private sampleQuat(view: DataView, base: number, count: number, stride: number, time: number, out: THREE.Quaternion) {
    if (count === 1) {
      out.set(
        view.getFloat32(base + 2, true),
        view.getFloat32(base + 6, true),
        view.getFloat32(base + 10, true),
        view.getFloat32(base + 14, true),
      );
      return;
    }

    const idx = findKeyframe(view, base, count, stride, time);
    const nextIdx = idx + 1;

    if (nextIdx >= count) {
      const o = base + idx * stride + 2;
      out.set(
        view.getFloat32(o, true),
        view.getFloat32(o + 4, true),
        view.getFloat32(o + 8, true),
        view.getFloat32(o + 12, true),
      );
      return;
    }

    const ts0 = view.getUint16(base + idx * stride, true);
    const ts1 = view.getUint16(base + nextIdx * stride, true);
    const dt = ts1 - ts0;
    const t = dt > 0 ? (time - ts0) / dt : 0;

    slerpQuat(out, view, base + idx * stride + 2, base + nextIdx * stride + 2, t);
  }
}

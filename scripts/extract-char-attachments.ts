/**
 * Extract character model attachment points from all available sources.
 *
 * Sources checked (in priority order for att 11):
 * 1. Extracted patch files (data/patch/patch-N/) -- matches what convert-model.ts uses
 * 2. MPQ archives (data/model/patch.MPQ, model.MPQ) -- base game data
 *
 * Outputs data/char-attachments.json with att 11 positions for each race/gender.
 * convert-model.ts consults this instead of the crown-bone heuristic.
 *
 * Findings: Most vanilla races (orc, human-M, dwarf, night-elf, scourge, tauren)
 * do NOT define att 11 in any M2 source. Only gnome-M/F, human-F, troll-M/F have
 * native att 11 in patch files. Goblin-M/F have it in patch.MPQ (different model version).
 *
 * Usage: bun run scripts/extract-char-attachments.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const { FS, MPQ } = await import('@wowserhq/stormjs');

const ROOT = resolve(import.meta.dirname, '..');
const DATA_DIR = resolve(ROOT, 'data/model');
const OUT_PATH = resolve(ROOT, 'data/char-attachments.json');

// ─── Character Models ────────────────────────────────────────────────────────

interface CharacterModel {
  slug: string;
  patchPath: string; // local extracted patch file
  mpqPath: string;   // backslash MPQ internal path
}

const CHARACTER_MODELS: CharacterModel[] = [
  { slug: 'blood-elf-male',    patchPath: 'data/patch/patch-6/Character/BloodElf/Male/BloodElfMale.M2',       mpqPath: 'Character\\BloodElf\\Male\\BloodElfMale.m2' },
  { slug: 'blood-elf-female',  patchPath: 'data/patch/patch-6/Character/BloodElf/Female/BloodElfFemale.M2',   mpqPath: 'Character\\BloodElf\\Female\\BloodElfFemale.m2' },
  { slug: 'dwarf-male',        patchPath: 'data/patch/patch-6/Character/Dwarf/Male/DwarfMale.M2',             mpqPath: 'Character\\Dwarf\\Male\\DwarfMale.m2' },
  { slug: 'dwarf-female',      patchPath: 'data/patch/patch-6/Character/Dwarf/Female/DwarfFemale.M2',         mpqPath: 'Character\\Dwarf\\Female\\DwarfFemale.m2' },
  { slug: 'gnome-male',        patchPath: 'data/patch/patch-6/Character/Gnome/Male/GnomeMale.M2',             mpqPath: 'Character\\Gnome\\Male\\GnomeMale.m2' },
  { slug: 'gnome-female',      patchPath: 'data/patch/patch-6/Character/Gnome/Female/GnomeFemale.M2',         mpqPath: 'Character\\Gnome\\Female\\GnomeFemale.m2' },
  { slug: 'goblin-male',       patchPath: 'data/patch/patch-7/Character/Goblin/Male/GoblinMale.m2',           mpqPath: 'Character\\Goblin\\Male\\GoblinMale.m2' },
  { slug: 'goblin-female',     patchPath: 'data/patch/patch-7/Character/Goblin/Female/GoblinFemale.m2',       mpqPath: 'Character\\Goblin\\Female\\GoblinFemale.m2' },
  { slug: 'human-male',        patchPath: 'data/patch/patch-6/Character/Human/Male/HumanMale.m2',             mpqPath: 'Character\\Human\\Male\\HumanMale.m2' },
  { slug: 'human-female',      patchPath: 'data/patch/patch-6/Character/Human/Female/HumanFemale.M2',         mpqPath: 'Character\\Human\\Female\\HumanFemale.m2' },
  { slug: 'night-elf-male',    patchPath: 'data/patch/patch-6/Character/NightElf/Male/NightElfMale.M2',       mpqPath: 'Character\\NightElf\\Male\\NightElfMale.m2' },
  { slug: 'night-elf-female',  patchPath: 'data/patch/patch-6/Character/NightElf/Female/NightElfFemale.M2',   mpqPath: 'Character\\NightElf\\Female\\NightElfFemale.m2' },
  { slug: 'orc-male',          patchPath: 'data/patch/patch-6/Character/Orc/Male/OrcMale.M2',                 mpqPath: 'Character\\Orc\\Male\\OrcMale.m2' },
  { slug: 'orc-female',        patchPath: 'data/patch/patch-6/Character/Orc/Female/OrcFemale.M2',             mpqPath: 'Character\\Orc\\Female\\OrcFemale.m2' },
  { slug: 'scourge-male',      patchPath: 'data/patch/patch-6/Character/Scourge/Male/ScourgeMale.M2',         mpqPath: 'Character\\Scourge\\Male\\ScourgeMale.m2' },
  { slug: 'scourge-female',    patchPath: 'data/patch/patch-6/Character/Scourge/Female/ScourgeFemale.M2',     mpqPath: 'Character\\Scourge\\Female\\ScourgeFemale.m2' },
  { slug: 'tauren-male',       patchPath: 'data/patch/patch-6/Character/Tauren/Male/TaurenMale.M2',           mpqPath: 'Character\\Tauren\\Male\\TaurenMale.m2' },
  { slug: 'tauren-female',     patchPath: 'data/patch/patch-6/Character/Tauren/Female/TaurenFemale.M2',       mpqPath: 'Character\\Tauren\\Female\\TaurenFemale.m2' },
  { slug: 'troll-male',        patchPath: 'data/patch/patch-6/Character/Troll/Male/TrollMale.M2',             mpqPath: 'Character\\Troll\\Male\\TrollMale.m2' },
  { slug: 'troll-female',      patchPath: 'data/patch/patch-6/Character/Troll/Female/TrollFemale.M2',         mpqPath: 'Character\\Troll\\Female\\TrollFemale.m2' },
];

// ─── M2 Attachment Parser ────────────────────────────────────────────────────

interface M2Arr { count: number; ofs: number; }
interface AttachmentPoint { id: number; bone: number; pos: [number, number, number]; }

const WANTED_ATTACHMENT_IDS = new Set([1, 2, 5, 6, 11]);
const ATTACHMENT_STRUCT_SIZE = 48;

function parseAttachments(buf: Buffer): AttachmentPoint[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  function arr(off: number): M2Arr {
    return { count: view.getUint32(off, true), ofs: view.getUint32(off + 4, true) };
  }

  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'MD20') throw new Error(`Bad magic: ${magic}`);

  const version = view.getUint32(4, true);
  if (version !== 256) throw new Error(`Expected version 256, got ${version}`);

  const attachmentsArr = arr(252);

  const attachments: AttachmentPoint[] = [];
  for (let i = 0; i < attachmentsArr.count; i++) {
    const ao = attachmentsArr.ofs + i * ATTACHMENT_STRUCT_SIZE;
    if (ao + ATTACHMENT_STRUCT_SIZE > buf.byteLength) break;
    const id = view.getUint32(ao, true);
    if (!WANTED_ATTACHMENT_IDS.has(id)) continue;
    const bone = view.getUint16(ao + 4, true);
    const pos: [number, number, number] = [
      view.getFloat32(ao + 8, true),
      view.getFloat32(ao + 12, true),
      view.getFloat32(ao + 16, true),
    ];
    if (Math.abs(pos[0]) > 10 || Math.abs(pos[1]) > 10 || Math.abs(pos[2]) > 10) continue;
    attachments.push({ id, bone, pos });
  }
  return attachments;
}

// ─── MPQ Setup ───────────────────────────────────────────────────────────────

console.log('Mounting MPQ archives...');
FS.mkdir('/stormjs');
FS.mount(FS.filesystems.NODEFS, { root: DATA_DIR }, '/stormjs');

const mpqNames = ['patch.MPQ', 'model.MPQ'];
const mpqs: { name: string; mpq: any }[] = [];

for (const name of mpqNames) {
  try {
    const m = await MPQ.open(`/stormjs/${name}`, 'r');
    mpqs.push({ name, mpq: m });
    console.log(`  Opened ${name}`);
  } catch {
    console.log(`  Skipped ${name} (not found)`);
  }
}

function readMpqFile(mpq: any, path: string): Buffer {
  const file = mpq.openFile(path);
  const data = file.read();
  file.close();
  return Buffer.from(data);
}

// ─── Extract from all sources ────────────────────────────────────────────────

type AttachmentMap = Record<string, AttachmentPoint[]>;
const result: AttachmentMap = {};

for (const model of CHARACTER_MODELS) {
  // 1. Try extracted patch file first (matches what convert-model.ts actually uses)
  const patchFullPath = resolve(ROOT, model.patchPath);
  let patchAtts: AttachmentPoint[] | null = null;
  if (existsSync(patchFullPath)) {
    try {
      patchAtts = parseAttachments(readFileSync(patchFullPath));
    } catch { /* skip */ }
  }

  // 2. Try MPQs (prefer whichever has att 11)
  let mpqAtts: AttachmentPoint[] | null = null;
  let mpqSource = '';
  for (const { name, mpq } of mpqs) {
    try {
      const atts = parseAttachments(readMpqFile(mpq, model.mpqPath));
      if (!mpqAtts || (atts.some(a => a.id === 11) && !mpqAtts.some(a => a.id === 11))) {
        mpqAtts = atts;
        mpqSource = name;
      }
    } catch { /* not in this MPQ */ }
  }

  // 3. Merge: patch file takes priority, MPQ fills gaps
  const patchHas11 = patchAtts?.some(a => a.id === 11) ?? false;
  const mpqHas11 = mpqAtts?.some(a => a.id === 11) ?? false;

  let finalAtts: AttachmentPoint[];
  let source: string;

  if (patchHas11) {
    // Patch file has att 11 — use it (bone indices match convert-model.ts)
    finalAtts = patchAtts!;
    source = 'patch-file';
  } else if (mpqHas11) {
    // MPQ has att 11 but patch file doesn't — merge MPQ att 11 into patch data
    // Note: bone index is from MPQ's model version, may differ
    finalAtts = patchAtts ? [...patchAtts] : (mpqAtts ? [...mpqAtts] : []);
    if (patchAtts && mpqAtts) {
      const mpqAtt11 = mpqAtts.find(a => a.id === 11)!;
      finalAtts.push(mpqAtt11);
    }
    source = `mpq(${mpqSource})`;
  } else if (patchAtts) {
    finalAtts = patchAtts;
    source = 'patch-file(no att 11)';
  } else if (mpqAtts) {
    finalAtts = mpqAtts;
    source = `mpq(${mpqSource},no att 11)`;
  } else {
    console.log(`  MISS  ${model.slug}`);
    continue;
  }

  result[model.slug] = finalAtts;
  const att11 = finalAtts.find(a => a.id === 11);
  const att11Str = att11
    ? `att11=[${att11.pos.map(v => v.toFixed(3)).join(', ')}] bone=${att11.bone}`
    : 'NO ATT 11 (heuristic needed)';
  console.log(`  ${model.slug.padEnd(20)} ${source.padEnd(24)} ${att11Str}`);
}

// ─── Write Output ────────────────────────────────────────────────────────────

writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));

const withAtt11 = Object.values(result).filter(atts => atts.some(a => a.id === 11)).length;
const total = Object.keys(result).length;
console.log(`\nWrote ${OUT_PATH}`);
console.log(`  ${total} models total, ${withAtt11} with native att 11, ${total - withAtt11} need heuristic`);

#!/usr/bin/env bun
/**
 * Extract all required files from a Turtle WoW (1.12.x) client installation.
 *
 * This is the one-stop setup script for new users. Point it at your TurtleWoW
 * folder and it will:
 *   1. Copy model.MPQ, texture.MPQ, patch.MPQ → data/model/
 *   2. Extract patch-2 through patch-9 and patch-y MPQ contents → data/patch/
 *   3. Extract & convert essential DBC files → data/dbc/ (JSON)
 *   4. Extract character hair textures from texture.MPQ → public/models/
 *
 * After running this, run the asset pipeline:
 *   bun run scripts/extract-mpq-items.ts
 *   bun run scripts/extract-mpq-textures.ts
 *   bun run scripts/convert-model.ts
 *   bun run scripts/convert-textures.ts
 *   bun run scripts/convert-item-textures.ts
 *   bun run scripts/convert-item.ts
 *   bun run scripts/build-item-catalog.ts
 *
 * Usage:
 *   bun run scripts/setup-from-client.ts /path/to/TurtleWoW
 *   bun run scripts/setup-from-client.ts ~/Games/TurtleWoW
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { resolve, basename } from 'path';

const { FS, MPQ } = await import('@wowserhq/stormjs');
// Blp import available if needed for future texture extraction
// const { Blp, BLP_IMAGE_FORMAT } = await import('@wowserhq/format');

const ROOT = resolve(import.meta.dirname, '..');

// ── Config ──────────────────────────────────────────────────────────────────

/** MPQ archives to copy wholesale into data/model/ */
const BASE_MPQS = ['model.MPQ', 'texture.MPQ', 'patch.MPQ'];

/** Numbered patch MPQs to extract into data/patch/ directories */
const PATCH_MPQS = [
  'patch-2.MPQ', 'patch-3.MPQ', 'patch-4.MPQ', 'patch-5.MPQ',
  'patch-6.MPQ', 'patch-7.MPQ', 'patch-8.MPQ', 'patch-9.MPQ',
  'patch-y.MPQ',
];

/** Essential DBC files needed by the viewer pipeline */
const ESSENTIAL_DBCS = [
  'ItemDisplayInfo',
  'CharSections',
  'ChrRaces',
  'AnimationData',
  'HelmetGeosetVisData',
  'CreatureDisplayInfo',
  'CreatureModelData',
  'ItemClass',
  'ItemSubClass',
  'ItemVisualEffects',
  'ItemVisuals',
];

/** Internal paths to extract from patch MPQs */
const EXTRACT_PREFIXES = [
  'Character\\',
  'Item\\',
  'DBFilesClient\\',
];

// ── DBC Parser (vanilla 1.12.x format) ─────────────────────────────────────

interface DbcHeader {
  magic: string;
  recordCount: number;
  fieldCount: number;
  recordSize: number;
  stringBlockSize: number;
}

function parseDbcHeader(buf: Buffer): DbcHeader {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    magic: buf.toString('ascii', 0, 4),
    recordCount: view.getUint32(4, true),
    fieldCount: view.getUint32(8, true),
    recordSize: view.getUint32(12, true),
    stringBlockSize: view.getUint32(16, true),
  };
}

function getDbcString(stringBlock: Buffer, offset: number): string {
  if (offset === 0) return '';
  let end = offset;
  while (end < stringBlock.length && stringBlock[end] !== 0) end++;
  return stringBlock.toString('utf-8', offset, end);
}

/**
 * DBC field schemas for the tables we care about.
 * Each field is [name, type] where type is 'u32', 'i32', 'f32', or 'str'.
 * Fields marked 'str' are uint32 offsets into the string block.
 *
 * Field counts verified against actual Turtle WoW patch-9 DBC binaries:
 *   ItemDisplayInfo: 23 fields (92B)
 *   CharSections: 10 fields (40B)
 *   ChrRaces: 29 fields (116B)
 *   AnimationData: 7 fields (28B)
 *   HelmetGeosetVisData: 6 fields (24B)
 *   CreatureDisplayInfo: 12 fields (48B)
 *   CreatureModelData: 16 fields (64B)
 *   ItemClass: 12 fields (48B)
 *   ItemSubClass: 28 fields (112B)
 *   ItemVisualEffects: 2 fields (8B)
 *   ItemVisuals: 6 fields (24B)
 */
const DBC_SCHEMAS: Record<string, [string, string][]> = {
  // 23 fields — verified against Thunderfury (ID 20190) raw dump
  ItemDisplayInfo: [
    ['ID', 'u32'],
    ['ModelName_0', 'str'], ['ModelName_1', 'str'],
    ['ModelTexture_0', 'str'], ['ModelTexture_1', 'str'],
    ['Icon_0', 'str'], ['Icon_1', 'str'],
    ['GeosetGroup_0', 'u32'], ['GeosetGroup_1', 'u32'], ['GeosetGroup_2', 'u32'],
    ['Flags', 'u32'],
    ['GroupSoundIndex', 'u32'],
    ['SpellVisualID', 'u32'],
    ['HelmetGeosetVis', 'u32'],
    ['Texture_0', 'str'], ['Texture_1', 'str'], ['Texture_2', 'str'], ['Texture_3', 'str'],
    ['Texture_4', 'str'], ['Texture_5', 'str'], ['Texture_6', 'str'], ['Texture_7', 'str'],
    ['ItemVisual', 'u32'],
  ],
  // 10 fields — confirmed match
  CharSections: [
    ['ID', 'u32'],
    ['RaceID', 'u32'],
    ['SexID', 'u32'],
    ['BaseSection', 'u32'],
    ['TextureName_0', 'str'], ['TextureName_1', 'str'], ['TextureName_2', 'str'],
    ['Flags', 'u32'],
    ['VariationIndex', 'u32'],
    ['ColorIndex', 'u32'],
  ],
  // 29 fields — Turtle WoW extended (adds LoginEffectSpellID, CombatStunSpellID, StartingTaxiNodes)
  ChrRaces: [
    ['ID', 'u32'],
    ['Flags', 'u32'],
    ['FactionID', 'u32'],
    ['ExplorationSoundID', 'u32'],
    ['MaleDisplayId', 'u32'],
    ['FemaleDisplayId', 'u32'],
    ['ClientPrefix', 'str'],
    ['MountScale', 'f32'],
    ['BaseLanguage', 'u32'],
    ['CreatureType', 'u32'],
    ['LoginEffectSpellID', 'u32'],
    ['CombatStunSpellID', 'u32'],
    ['ResSicknessSpellID', 'u32'],
    ['SplashSoundID', 'u32'],
    ['StartingTaxiNodes', 'u32'],
    ['ClientFileString', 'str'],
    ['CinematicSequenceID', 'u32'],
    ['Name_enUS', 'str'], ['Name_enGB', 'str'], ['Name_koKR', 'str'], ['Name_frFR', 'str'],
    ['Name_deDE', 'str'], ['Name_enCN', 'str'], ['Name_zhCN', 'str'], ['Name_enTW', 'str'],
    ['Name_Flags', 'u32'],
    ['FacialHairCustomization_0', 'str'], ['FacialHairCustomization_1', 'str'],
    ['HairCustomization', 'str'],
  ],
  // 7 fields — Turtle WoW variant (no BehaviorTier)
  AnimationData: [
    ['ID', 'u32'],
    ['Name', 'str'],
    ['Weaponflags', 'u32'],
    ['Bodyflags', 'u32'],
    ['BehaviorID', 'u32'],
    ['Flags', 'u32'],
    ['Fallback', 'u32'],
  ],
  // 6 fields — ID + 5 hide geoset slots
  HelmetGeosetVisData: [
    ['ID', 'u32'],
    ['HideGeoset_0', 'u32'], ['HideGeoset_1', 'u32'], ['HideGeoset_2', 'u32'],
    ['HideGeoset_3', 'u32'], ['HideGeoset_4', 'u32'],
  ],
  // 12 fields — Turtle WoW variant (no ParticleColorID)
  CreatureDisplayInfo: [
    ['ID', 'u32'],
    ['ModelID', 'u32'],
    ['SoundID', 'u32'],
    ['ExtendedDisplayInfoID', 'u32'],
    ['CreatureModelScale', 'f32'],
    ['CreatureModelAlpha', 'u32'],
    ['TextureVariation_0', 'str'], ['TextureVariation_1', 'str'], ['TextureVariation_2', 'str'],
    ['SizeClass', 'u32'],
    ['BloodID', 'u32'],
    ['NPCSoundID', 'u32'],
  ],
  // 16 fields — includes CollisionWidth/Height
  CreatureModelData: [
    ['ID', 'u32'],
    ['Flags', 'u32'],
    ['ModelName', 'str'],
    ['SizeClass', 'u32'],
    ['ModelScale', 'f32'],
    ['BloodID', 'u32'],
    ['FootprintTextureID', 'u32'],
    ['FootprintTextureLength', 'f32'],
    ['FootprintTextureWidth', 'f32'],
    ['FootprintParticleScale', 'f32'],
    ['FoleyMaterialID', 'u32'],
    ['FootstepShakeSize', 'u32'],
    ['DeathThudShakeSize', 'u32'],
    ['SoundID', 'u32'],
    ['CollisionWidth', 'f32'],
    ['CollisionHeight', 'f32'],
  ],
  // 12 fields — ID + SubclassMapID + Flags + 8 locale strings + flags
  ItemClass: [
    ['ID', 'u32'],
    ['SubclassMapID', 'u32'],
    ['Flags', 'u32'],
    ['ClassName_enUS', 'str'], ['ClassName_enGB', 'str'], ['ClassName_koKR', 'str'], ['ClassName_frFR', 'str'],
    ['ClassName_deDE', 'str'], ['ClassName_enCN', 'str'], ['ClassName_zhCN', 'str'], ['ClassName_enTW', 'str'],
    ['ClassName_Flags', 'u32'],
  ],
  // 28 fields — no VerboseName in TW variant
  ItemSubClass: [
    ['ID', 'u32'],
    ['ClassID', 'u32'],
    ['SubClassID', 'u32'],
    ['PrerequisiteProficiency', 'u32'],
    ['PostrequisiteProficiency', 'u32'],
    ['Flags', 'u32'],
    ['DisplayFlags', 'u32'],
    ['WeaponParrySeq', 'u32'],
    ['WeaponReadySeq', 'u32'],
    ['WeaponAttackSeq', 'u32'],
    ['WeaponSwingSize', 'u32'],
    ['DisplayName_enUS', 'str'], ['DisplayName_enGB', 'str'], ['DisplayName_koKR', 'str'], ['DisplayName_frFR', 'str'],
    ['DisplayName_deDE', 'str'], ['DisplayName_enCN', 'str'], ['DisplayName_zhCN', 'str'], ['DisplayName_enTW', 'str'],
    ['DisplayName_Flags', 'u32'],
    ['VerboseName_enUS', 'str'], ['VerboseName_enGB', 'str'], ['VerboseName_koKR', 'str'], ['VerboseName_frFR', 'str'],
    ['VerboseName_deDE', 'str'], ['VerboseName_enCN', 'str'], ['VerboseName_zhCN', 'str'], ['VerboseName_enTW', 'str'],
  ],
  // 2 fields
  ItemVisualEffects: [
    ['ID', 'u32'],
    ['Model', 'str'],
  ],
  // 6 fields
  ItemVisuals: [
    ['ID', 'u32'],
    ['Slot_0', 'u32'], ['Slot_1', 'u32'], ['Slot_2', 'u32'],
    ['Slot_3', 'u32'], ['Slot_4', 'u32'],
  ],
};

/**
 * Parse a DBC binary file into an array of JSON records.
 * Uses the schema to determine field types and string lookups.
 * If no schema is available or field count differs, dumps raw uint32 fields.
 */
function parseDbc(buf: Buffer, name: string): any[] {
  const header = parseDbcHeader(buf);
  if (header.magic !== 'WDBC') {
    throw new Error(`Bad DBC magic: ${header.magic} (expected WDBC)`);
  }

  const dataStart = 20; // after 20-byte header
  const stringBlockStart = dataStart + header.recordCount * header.recordSize;
  const stringBlock = buf.subarray(stringBlockStart, stringBlockStart + header.stringBlockSize);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let schema = DBC_SCHEMAS[name];

  // Validate schema field count matches actual DBC
  if (schema && schema.length !== header.fieldCount) {
    console.warn(`    WARN: ${name} schema has ${schema.length} fields but DBC has ${header.fieldCount} — falling back to raw parse`);
    schema = undefined as any;
  }

  const records: any[] = [];

  for (let i = 0; i < header.recordCount; i++) {
    const recordOfs = dataStart + i * header.recordSize;
    const record: any = {};

    if (schema) {
      // Schema-based parsing
      let fieldOfs = 0;
      for (const [fieldName, fieldType] of schema) {
        if (fieldOfs >= header.recordSize) break;
        const absOfs = recordOfs + fieldOfs;

        switch (fieldType) {
          case 'u32':
            record[fieldName] = view.getUint32(absOfs, true);
            break;
          case 'i32':
            record[fieldName] = view.getInt32(absOfs, true);
            break;
          case 'f32':
            record[fieldName] = view.getFloat32(absOfs, true);
            break;
          case 'str':
            record[fieldName] = getDbcString(stringBlock, view.getUint32(absOfs, true));
            break;
        }
        fieldOfs += 4;
      }
    } else {
      // Raw dump — all fields as uint32
      record.ID = view.getUint32(recordOfs, true);
      for (let f = 1; f < header.fieldCount; f++) {
        record[`field_${f}`] = view.getUint32(recordOfs + f * 4, true);
      }
    }

    records.push(record);
  }

  return records;
}

/**
 * Transform parsed DBC records into the format expected by the existing pipeline.
 * The existing code expects specific field names (e.g., ModelName as array, Texture as array).
 */
function transformForPipeline(name: string, records: any[]): any[] {
  if (name === 'ItemDisplayInfo') {
    return records.map(r => ({
      ID: r.ID,
      ModelName: [r.ModelName_0 || '', r.ModelName_1 || ''],
      ModelTexture: [r.ModelTexture_0 || '', r.ModelTexture_1 || ''],
      InventoryIcon: [r.Icon_0 || ''],
      GeosetGroup: [r.GeosetGroup_0 || 0, r.GeosetGroup_1 || 0, r.GeosetGroup_2 || 0],
      Flags: r.Flags || 0,
      SpellVisualID: r.SpellVisualID || 0,
      GroupSoundIndex: r.GroupSoundIndex || 0,
      HelmetGeosetVisID: [r.HelmetGeosetVis || 0, 0],
      Texture: [
        r.Texture_0 || '', r.Texture_1 || '', r.Texture_2 || '', r.Texture_3 || '',
        r.Texture_4 || '', r.Texture_5 || '', r.Texture_6 || '', r.Texture_7 || '',
      ],
      ItemVisual: r.ItemVisual || 0,
      ParticleColorID: 0,
    }));
  }

  if (name === 'CharSections') {
    return records.map(r => ({
      ID: r.ID,
      RaceID: r.RaceID,
      SexID: r.SexID,
      BaseSection: r.BaseSection,
      TextureName: [r.TextureName_0 || '', r.TextureName_1 || '', r.TextureName_2 || ''],
      Flags: r.Flags,
      VariationIndex: r.VariationIndex,
      ColorIndex: r.ColorIndex,
    }));
  }

  if (name === 'ChrRaces') {
    return records.map(r => ({
      ID: r.ID,
      Flags: r.Flags,
      FactionID: r.FactionID,
      ExplorationSoundID: r.ExplorationSoundID,
      MaleDisplayID: r.MaleDisplayId,
      FemaleDisplayID: r.FemaleDisplayId,
      ClientPrefix: r.ClientPrefix,
      MountScale: r.MountScale,
      BaseLanguage: r.BaseLanguage,
      CreatureType: r.CreatureType,
      ResSicknessSpellID: r.ResSicknessSpellID,
      SplashSoundID: r.SplashSoundID,
      ClientFileString: r.ClientFileString,
      CinematicSequenceID: r.CinematicSequenceID,
      Name_enUS: r.Name_enUS,
      FacialHairCustomization: [r.FacialHairCustomization_0 || '', r.FacialHairCustomization_1 || ''],
      HairCustomization: r.HairCustomization,
    }));
  }

  if (name === 'HelmetGeosetVisData') {
    return records.map(r => ({
      ID: r.ID,
      HideGeoset: [
        r.HideGeoset_0 || 0, r.HideGeoset_1 || 0, r.HideGeoset_2 || 0,
        r.HideGeoset_3 || 0, r.HideGeoset_4 || 0,
      ],
    }));
  }

  if (name === 'AnimationData') {
    return records.map(r => ({
      ID: r.ID,
      Name: r.Name,
      Weaponflags: r.Weaponflags || 0,
      Bodyflags: r.Bodyflags || 0,
      Flags: [r.Flags || 0],
      Fallback: r.Fallback || 0,
      BehaviorID: r.BehaviorID || 0,
      BehaviorTier: 0,
    }));
  }

  // For other tables, return records as-is (flat fields)
  return records;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function findCaseInsensitive(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  const nameLower = name.toLowerCase();
  for (const entry of readdirSync(dir)) {
    if (entry.toLowerCase() === nameLower) return entry;
  }
  return null;
}

function findMpqFile(dataDir: string, name: string): string | null {
  // Try exact match first
  const exact = resolve(dataDir, name);
  if (existsSync(exact)) return exact;

  // Try case-insensitive
  const match = findCaseInsensitive(dataDir, name);
  if (match) return resolve(dataDir, match);

  // Try common case variations
  const variations = [
    name,
    name.toLowerCase(),
    name.replace('.MPQ', '.mpq'),
    name.replace('.mpq', '.MPQ'),
  ];
  for (const v of variations) {
    const p = resolve(dataDir, v);
    if (existsSync(p)) return p;
  }

  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const clientDir = process.argv[2];

  if (!clientDir) {
    console.error(`
Usage: bun run scripts/setup-from-client.ts <path-to-TurtleWoW>

Example:
  bun run scripts/setup-from-client.ts ~/Games/TurtleWoW
  bun run scripts/setup-from-client.ts "C:\\Program Files\\TurtleWoW"

The path should point to the TurtleWoW installation root folder
(the one containing WoW.exe and a Data/ subfolder).
`);
    process.exit(1);
  }

  const resolvedClient = resolve(clientDir);

  // Find the Data directory (case-insensitive)
  let dataDir = resolve(resolvedClient, 'Data');
  if (!existsSync(dataDir)) {
    const match = findCaseInsensitive(resolvedClient, 'Data');
    if (match) {
      dataDir = resolve(resolvedClient, match);
    } else {
      console.error(`ERROR: Cannot find Data/ directory in ${resolvedClient}`);
      console.error(`\nExpected folder structure:`);
      console.error(`  ${resolvedClient}/`);
      console.error(`  ├── Data/`);
      console.error(`  │   ├── model.MPQ`);
      console.error(`  │   ├── texture.MPQ`);
      console.error(`  │   ├── patch.MPQ`);
      console.error(`  │   ├── patch-2.MPQ`);
      console.error(`  │   └── ...`);
      console.error(`  └── WoW.exe`);
      process.exit(1);
    }
  }

  console.log(`Turtle WoW Data dir: ${dataDir}`);
  console.log(`Project root: ${ROOT}\n`);

  // List what's in the Data directory
  const dataFiles = readdirSync(dataDir).filter(f => f.toLowerCase().endsWith('.mpq'));
  console.log(`Found ${dataFiles.length} MPQ files in Data/:`);
  for (const f of dataFiles.sort()) {
    const stat = statSync(resolve(dataDir, f));
    console.log(`  ${f} (${(stat.size / 1024 / 1024).toFixed(0)}M)`);
  }
  console.log();

  // ── Step 1: Copy base MPQs ──────────────────────────────────────────────

  console.log('=== Step 1: Copy base MPQ archives → data/model/ ===\n');
  const modelDir = resolve(ROOT, 'data/model');
  mkdirSync(modelDir, { recursive: true });

  for (const mpqName of BASE_MPQS) {
    const srcPath = findMpqFile(dataDir, mpqName);
    const dstPath = resolve(modelDir, mpqName);

    if (existsSync(dstPath)) {
      const srcSize = srcPath ? statSync(srcPath).size : 0;
      const dstSize = statSync(dstPath).size;
      if (srcSize === dstSize) {
        console.log(`  SKIP (exists, same size): ${mpqName}`);
        continue;
      }
    }

    if (!srcPath) {
      console.error(`  MISSING: ${mpqName} — not found in ${dataDir}`);
      continue;
    }

    const size = statSync(srcPath).size;
    console.log(`  Copying ${mpqName} (${(size / 1024 / 1024).toFixed(0)}M)...`);
    copyFileSync(srcPath, dstPath);
    console.log(`  OK: ${mpqName}`);
  }

  // ── Step 2: Extract patch MPQs ──────────────────────────────────────────

  console.log('\n=== Step 2: Extract patch MPQ contents → data/patch/ ===\n');

  // Mount point for stormjs
  let stormMounted = false;
  function ensureStormMount() {
    if (stormMounted) return;
    try { FS.mkdir('/clientdata'); } catch {}
    FS.mount(FS.filesystems.NODEFS, { root: dataDir }, '/clientdata');
    stormMounted = true;
  }

  // Also need to extract from base patch.MPQ into data/patch/patch/
  const allPatchMpqs = ['patch.MPQ', ...PATCH_MPQS];

  for (const mpqName of allPatchMpqs) {
    const srcPath = findMpqFile(dataDir, mpqName);
    if (!srcPath) {
      console.log(`  SKIP: ${mpqName} — not found`);
      continue;
    }

    // Determine output directory name
    const stem = basename(srcPath, '.MPQ').replace('.mpq', '').toLowerCase();
    const outDir = resolve(ROOT, 'data/patch', stem);

    // Check if already extracted (has files)
    if (existsSync(outDir)) {
      const existing = readdirSync(outDir);
      if (existing.length > 0) {
        console.log(`  SKIP (already extracted): ${mpqName} → data/patch/${stem}/ (${existing.length} entries)`);
        continue;
      }
    }

    console.log(`  Extracting ${mpqName} → data/patch/${stem}/...`);
    ensureStormMount();

    try {
      const actualName = findCaseInsensitive(dataDir, mpqName) || mpqName;
      const mpq = await MPQ.open(`/clientdata/${actualName}`, 'r');
      let extracted = 0;
      let skipped = 0;

      for (const prefix of EXTRACT_PREFIXES) {
        const wildcard = `${prefix}*`;
        let results: any[];
        try {
          results = mpq.search(wildcard);
        } catch {
          continue;
        }

        for (const r of results) {
          const internalPath: string = r.fileName;
          // Convert backslashes to forward slashes
          const relativePath = internalPath.replace(/\\/g, '/');
          const outPath = resolve(outDir, relativePath);

          if (existsSync(outPath)) {
            skipped++;
            continue;
          }

          try {
            const file = mpq.openFile(internalPath);
            const data = file.read();
            // IMPORTANT: Copy data immediately before closing the file or doing anything else.
            // stormjs returns a Uint8Array view into the WASM heap. If the heap is reallocated
            // by a subsequent operation, the view becomes stale and produces garbage.
            // data.slice(0) creates an independent copy that is safe to use later.
            const copy = data.slice(0);
            file.close();

            mkdirSync(resolve(outPath, '..'), { recursive: true });
            writeFileSync(outPath, copy);
            extracted++;
          } catch {
            // Some files in MPQ listings can't be read — skip silently
          }
        }
      }

      mpq.close();
      console.log(`  OK: ${extracted} files extracted, ${skipped} skipped (already exist)`);
    } catch (err: any) {
      console.error(`  ERROR: ${mpqName} — ${err.message}`);
    }
  }

  // ── Step 3: Convert DBC files to JSON ───────────────────────────────────

  console.log('\n=== Step 3: Convert DBC files → data/dbc/ (JSON) ===\n');

  const dbcOutDir = resolve(ROOT, 'data/dbc');
  mkdirSync(dbcOutDir, { recursive: true });

  // For each essential DBC, find the highest-priority version (highest patch number wins)
  const patchPriority = ['patch-9', 'patch-8', 'patch-7', 'patch-6', 'patch-5', 'patch-4', 'patch-3', 'patch-2', 'patch'];

  // We also need to check the base MPQ archives (dbc.MPQ, misc.MPQ, model.MPQ) for DBCs
  // not found in patches. Mount model dir for that.
  let modelMpqMounted = false;
  function ensureModelMount() {
    if (modelMpqMounted) return;
    try { FS.mkdir('/modeldata'); } catch {}
    FS.mount(FS.filesystems.NODEFS, { root: resolve(ROOT, 'data/model') }, '/modeldata');
    modelMpqMounted = true;
  }

  // Try to also mount dbc.MPQ or misc.MPQ if they exist
  const dbcMpqName = findCaseInsensitive(dataDir, 'dbc.MPQ') || findCaseInsensitive(dataDir, 'misc.MPQ');

  for (const dbcName of ESSENTIAL_DBCS) {
    const jsonPath = resolve(dbcOutDir, `${dbcName}.json`);

    if (existsSync(jsonPath)) {
      console.log(`  SKIP (exists): ${dbcName}.json`);
      continue;
    }

    // Search patches (highest priority first)
    let dbcBuf: Buffer | null = null;
    let source = '';

    for (const patchDir of patchPriority) {
      const dbcPath = resolve(ROOT, 'data/patch', patchDir, 'DBFilesClient', `${dbcName}.dbc`);
      if (existsSync(dbcPath)) {
        dbcBuf = Buffer.from(readFileSync(dbcPath));
        source = `data/patch/${patchDir}`;
        break;
      }
    }

    // If not found in patches, try base MPQs (dbc.MPQ, misc.MPQ, model.MPQ)
    if (!dbcBuf) {
      ensureStormMount();
      const baseMpqsToCheck: string[] = [];
      if (dbcMpqName) baseMpqsToCheck.push(dbcMpqName);

      // Also check model.MPQ which sometimes has DBCs
      ensureModelMount();
      const modelMpqs = ['model.MPQ'];
      for (const mName of modelMpqs) {
        if (existsSync(resolve(ROOT, 'data/model', mName))) {
          try {
            const m = await MPQ.open(`/modeldata/${mName}`, 'r');
            const mpqPath = `DBFilesClient\\${dbcName}.dbc`;
            if (m.hasFile(mpqPath)) {
              const file = m.openFile(mpqPath);
              const data = file.read();
              const copy = data.slice(0); // copy before WASM heap reallocation
              file.close();
              dbcBuf = Buffer.from(copy);
              source = mName;
            }
            m.close();
            if (dbcBuf) break;
          } catch {}
        }
      }

      // Try dbc.MPQ from client
      if (!dbcBuf && dbcMpqName) {
        try {
          const m = await MPQ.open(`/clientdata/${dbcMpqName}`, 'r');
          const mpqPath = `DBFilesClient\\${dbcName}.dbc`;
          if (m.hasFile(mpqPath)) {
            const file = m.openFile(mpqPath);
            const data = file.read();
            const copy = data.slice(0); // copy before WASM heap reallocation
            file.close();
            dbcBuf = Buffer.from(copy);
            source = dbcMpqName;
          }
          m.close();
        } catch {}
      }
    }

    if (!dbcBuf) {
      console.error(`  MISSING: ${dbcName}.dbc — not found in any patch or MPQ`);
      continue;
    }

    try {
      const records = parseDbc(dbcBuf, dbcName);
      const transformed = transformForPipeline(dbcName, records);

      // Write JSON with 14 lines of log header to match existing format
      // (the pipeline reads line 15 for the JSON array)
      const logLines = [
        `Analyzing setup-from-client.ts ...`,
        ...Array(13).fill(`[setup] Converted ${dbcName}.dbc from ${source}`),
      ];
      const jsonContent = logLines.join('\n') + '\n' + JSON.stringify(transformed);
      writeFileSync(jsonPath, jsonContent);

      console.log(`  OK: ${dbcName}.json — ${records.length} records from ${source}`);
    } catch (err: any) {
      console.error(`  ERROR: ${dbcName} — ${err.message}`);
    }
  }

  // ── Step 4: Extract character hair textures ─────────────────────────────

  console.log('\n=== Step 4: Extract character hair textures → public/models/ ===\n');

  ensureModelMount();

  // Hair textures are created by convert-textures.ts from patch BLPs.
  // Just ensure the output directories exist.
  const RACE_SLUGS = [
    'blood-elf-male', 'blood-elf-female', 'dwarf-male', 'dwarf-female',
    'gnome-male', 'gnome-female', 'goblin-male', 'goblin-female',
    'human-male', 'human-female', 'night-elf-male', 'night-elf-female',
    'orc-male', 'orc-female', 'scourge-male', 'scourge-female',
    'tauren-male', 'tauren-female', 'troll-male', 'troll-female',
  ];

  let hairExists = 0;
  for (const slug of RACE_SLUGS) {
    mkdirSync(resolve(ROOT, 'public/models', slug, 'textures'), { recursive: true });
    if (existsSync(resolve(ROOT, 'public/models', slug, 'textures', 'hair.tex'))) hairExists++;
  }

  console.log(`  ${hairExists}/20 hair textures already exist`);
  console.log(`  Hair + skin textures will be created by: bun run scripts/convert-textures.ts`);

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(60));
  console.log('Setup complete!\n');

  // Verify what we have
  const hasModelMpq = existsSync(resolve(ROOT, 'data/model/model.MPQ'));
  const hasTextureMpq = existsSync(resolve(ROOT, 'data/model/texture.MPQ'));
  const hasPatchMpq = existsSync(resolve(ROOT, 'data/model/patch.MPQ'));
  const patchDirs = readdirSync(resolve(ROOT, 'data/patch')).filter(
    d => statSync(resolve(ROOT, 'data/patch', d)).isDirectory()
  );
  const dbcFiles = readdirSync(dbcOutDir).filter(f => f.endsWith('.json'));

  console.log('Data status:');
  console.log(`  model.MPQ:   ${hasModelMpq ? 'OK' : 'MISSING'}`);
  console.log(`  texture.MPQ: ${hasTextureMpq ? 'OK' : 'MISSING'}`);
  console.log(`  patch.MPQ:   ${hasPatchMpq ? 'OK' : 'MISSING'}`);
  console.log(`  Patch dirs:  ${patchDirs.length} (${patchDirs.join(', ')})`);
  console.log(`  DBC JSONs:   ${dbcFiles.length} files`);

  console.log('\nNext steps — run the asset pipeline:\n');
  console.log('  # 1. Extract item models + textures from MPQ archives');
  console.log('  bun run scripts/extract-mpq-items.ts');
  console.log('  bun run scripts/extract-mpq-textures.ts');
  console.log('');
  console.log('  # 2. Convert character models + skin/hair textures');
  console.log('  bun run scripts/convert-model.ts');
  console.log('  bun run scripts/convert-textures.ts');
  console.log('');
  console.log('  # 3. Convert patch-based item textures and models');
  console.log('  bun run scripts/convert-item-textures.ts');
  console.log('  bun run scripts/convert-item.ts');
  console.log('');
  console.log('  # 4. Build the item catalog');
  console.log('  bun run scripts/build-item-catalog.ts');
  console.log('');
  console.log('  # 5. Start the dev server');
  console.log('  bun run dev');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

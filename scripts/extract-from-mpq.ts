/**
 * Extract base vanilla textures and DBCs from MPQ archives.
 *
 * Uses @wowserhq/stormjs to read data/texture.MPQ and data/model.MPQ,
 * extracting the Human Male character textures needed for skin compositing
 * and any missing DBC files.
 *
 * Usage: npx tsx scripts/extract-from-mpq.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const { FS, MPQ } = await import('@wowserhq/stormjs');

const ROOT = resolve(import.meta.dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');
const EXTRACT_DIR = resolve(DATA_DIR, 'extracted');

// Mount the data directory into Emscripten's virtual filesystem
FS.mkdir('/stormjs');
FS.mount(FS.filesystems.NODEFS, { root: DATA_DIR }, '/stormjs');

// --- Texture extraction targets ---
// From CharSections.dbc: Human Male (RaceID=1, SexID=0) textures
// We extract skin color 0 (default) for all types.

const TEXTURE_FILES = [
  // BaseSection 0: Body skin (skin color variants 00-09)
  'Character\\Human\\Male\\HumanMaleSkin00_00.blp',
  'Character\\Human\\Male\\HumanMaleSkin00_01.blp',
  'Character\\Human\\Male\\HumanMaleSkin00_02.blp',
  'Character\\Human\\Male\\HumanMaleSkin00_03.blp',
  'Character\\Human\\Male\\HumanMaleSkin00_04.blp',
  'Character\\Human\\Male\\HumanMaleSkin00_05.blp',
  'Character\\Human\\Male\\HumanMaleSkin00_06.blp',
  'Character\\Human\\Male\\HumanMaleSkin00_07.blp',
  'Character\\Human\\Male\\HumanMaleSkin00_08.blp',
  'Character\\Human\\Male\\HumanMaleSkin00_09.blp',

  // BaseSection 1: Face textures (face variation 0, skin colors 0-9)
  'Character\\Human\\Male\\HumanMaleFaceLower00_00.blp',
  'Character\\Human\\Male\\HumanMaleFaceUpper00_00.blp',
  'Character\\Human\\Male\\HumanMaleFaceLower00_01.blp',
  'Character\\Human\\Male\\HumanMaleFaceUpper00_01.blp',

  // BaseSection 3: Scalp textures (hairstyle 4, color 7 — matching current hair)
  'Character\\Human\\ScalpLowerHair02_07.blp',
  'Character\\Human\\ScalpUpperHair02_07.blp',

  // BaseSection 4: Underwear (skin color variants)
  'Character\\Human\\Male\\HumanMaleNakedPelvisSkin00_00.blp',
  'Character\\Human\\Male\\HumanMaleNakedTorsoSkin00_00.blp',
  'Character\\Human\\Male\\HumanMaleNakedPelvisSkin00_01.blp',
  'Character\\Human\\Male\\HumanMaleNakedTorsoSkin00_01.blp',
];

// --- DBC extraction targets ---
const DBC_FILES = [
  'DBFilesClient\\CharComponentTextureLayouts.dbc',
  'DBFilesClient\\CharComponentTextureSections.dbc',
  'DBFilesClient\\CharHairGeosets.dbc',
  'DBFilesClient\\CharacterFacialHairStyles.dbc',
];

function extractFile(mpq: any, _mpqName: string, internalPath: string, outDir: string): boolean {
  try {
    if (!mpq.hasFile(internalPath)) {
      console.log(`  SKIP (not found): ${internalPath}`);
      return false;
    }
    const file = mpq.openFile(internalPath);
    const data = file.read();
    file.close();

    // Convert backslashes to forward slashes for output path
    const relativePath = internalPath.replace(/\\/g, '/');
    const outPath = resolve(outDir, relativePath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, data);

    console.log(`  OK (${data.length} bytes): ${relativePath}`);
    return true;
  } catch (err: any) {
    console.log(`  ERROR: ${internalPath} — ${err.message}`);
    return false;
  }
}

async function main() {
  let extracted = 0;
  let skipped = 0;
  let errors = 0;

  // --- Extract textures from texture.MPQ ---
  console.log('Opening texture.MPQ...');
  const textureMpq = await MPQ.open('/stormjs/model/texture.MPQ', 'r');

  console.log(`\nExtracting ${TEXTURE_FILES.length} texture files:\n`);
  for (const path of TEXTURE_FILES) {
    const ok = extractFile(textureMpq, 'texture.MPQ', path, EXTRACT_DIR);
    if (ok) extracted++;
    else skipped++;
  }
  textureMpq.close();

  // --- Extract DBCs from model.MPQ ---
  console.log('\nOpening model.MPQ...');
  const modelMpq = await MPQ.open('/stormjs/model/model.MPQ', 'r');

  console.log(`\nExtracting ${DBC_FILES.length} DBC files:\n`);
  for (const path of DBC_FILES) {
    const ok = extractFile(modelMpq, 'model.MPQ', path, EXTRACT_DIR);
    if (ok) extracted++;
    else skipped++;
  }

  // If DBCs weren't in model.MPQ, they might be in a different archive structure.
  // Try searching for them.
  const missingDbcs = DBC_FILES.filter(p => !modelMpq.hasFile(p));
  if (missingDbcs.length > 0) {
    console.log(`\nSearching model.MPQ for DBC files...`);
    try {
      const dbcResults = modelMpq.search('DBFilesClient\\*.dbc');
      console.log(`  Found ${dbcResults.length} DBC files in model.MPQ`);
      if (dbcResults.length > 0) {
        console.log(`  Sample: ${dbcResults.slice(0, 5).map((r: any) => r.fileName).join(', ')}`);
      }
    } catch (err: any) {
      console.log(`  Search failed: ${err.message}`);
    }
  }

  modelMpq.close();

  // --- Also try searching texture.MPQ for any face/underwear textures ---
  console.log('\nSearching texture.MPQ for all Human Male textures...');
  const texMpq2 = await MPQ.open('/stormjs/model/texture.MPQ', 'r');
  try {
    const humanResults = texMpq2.search('Character\\Human\\Male\\*');
    console.log(`  Found ${humanResults.length} files matching Character\\Human\\Male\\*`);

    // Log unique prefixes to understand what's available
    const prefixes = new Set<string>();
    for (const r of humanResults) {
      const name = r.fileName as string;
      const match = name.match(/HumanMale(\w+?)(?:\d|\.)/);
      if (match) prefixes.add(match[1]);
    }
    console.log(`  Texture types: ${[...prefixes].sort().join(', ')}`);
  } catch (err: any) {
    console.log(`  Search failed: ${err.message}`);
  }
  texMpq2.close();

  console.log(`\n--- Summary ---`);
  console.log(`Extracted: ${extracted}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Errors:    ${errors}`);
  console.log(`Output:    ${EXTRACT_DIR}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

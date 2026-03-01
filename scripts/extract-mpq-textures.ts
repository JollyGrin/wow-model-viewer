/**
 * Extract vanilla item textures from texture.MPQ using ItemDisplayInfo.json.
 *
 * Reads all texture names from ItemDisplayInfo.json, attempts to extract each
 * from texture.MPQ with _U/_M/_F gender suffixes, converts BLP → .tex, and
 * writes to public/item-textures/{Region}/. Idempotent — skips existing .tex files.
 *
 * .tex format: uint16 width + uint16 height + raw RGBA pixels
 *
 * Usage: bun run scripts/extract-mpq-textures.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const { Blp, BLP_IMAGE_FORMAT } = await import('@wowserhq/format');
const { FS, MPQ } = await import('@wowserhq/stormjs');

const ROOT = resolve(import.meta.dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');

// Region index (from ItemDisplayInfo texture slot) → directory name
const REGION_BY_INDEX: Record<number, string> = {
  0: 'ArmUpperTexture',
  1: 'ArmLowerTexture',
  2: 'HandTexture',
  3: 'TorsoUpperTexture',
  4: 'TorsoLowerTexture',
  5: 'LegUpperTexture',
  6: 'LegLowerTexture',
  7: 'FootTexture',
};

// MPQ internal paths use these region names
const REGION_MPQ_PATH: Record<number, string> = {
  0: 'ArmUpperTexture',
  1: 'ArmLowerTexture',
  2: 'HandTexture',
  3: 'TorsoUpperTexture',
  4: 'TorsoLowerTexture',
  5: 'LegUpperTexture',
  6: 'LegLowerTexture',
  7: 'FootTexture',
};

const GENDER_SUFFIXES = ['_U', '_M', '_F'];

function writeTexFile(outPath: string, width: number, height: number, rgba: Uint8Array): number {
  const header = new Uint8Array(4);
  const headerView = new DataView(header.buffer);
  headerView.setUint16(0, width, true);
  headerView.setUint16(2, height, true);
  const output = new Uint8Array(4 + rgba.byteLength);
  output.set(header, 0);
  output.set(rgba, 4);
  writeFileSync(outPath, output);
  return output.byteLength;
}

/**
 * Check if a texture name already ends with a gender suffix.
 */
function endsWithGenderSuffix(name: string): boolean {
  return name.endsWith('_U') || name.endsWith('_M') || name.endsWith('_F');
}

async function main() {
  // --- Load ItemDisplayInfo ---
  console.log('Loading ItemDisplayInfo.json...');
  const idiRaw = readFileSync(resolve(ROOT, 'data/dbc/ItemDisplayInfo.json'), 'utf-8');
  const idiRecords: any[] = JSON.parse(idiRaw.split('\n')[14]);
  console.log(`  ${idiRecords.length} display records loaded.`);

  // --- Collect unique (textureName, regionIndex) pairs ---
  // ItemDisplayInfo has Texture[0..7] fields corresponding to region indices 0..7
  // The field names are: Texture_1 through Texture_8 (1-indexed in the JSON)
  // Actually let's check what the field names are
  const sampleRec = idiRecords[0];
  const textureFieldNames: string[] = [];

  // Try common field name patterns
  for (let i = 0; i < 8; i++) {
    // Check possible field names
    const candidates = [
      `Texture_${i}`, `Texture_${i + 1}`,
      `TextureName_${i}`, `TextureName_${i + 1}`,
      `Texture${i}`, `Texture${i + 1}`,
    ];
    for (const c of candidates) {
      if (c in sampleRec) {
        textureFieldNames.push(c);
        break;
      }
    }
  }

  // If field name detection failed, check all keys for texture-like fields
  if (textureFieldNames.length === 0) {
    const keys = Object.keys(sampleRec);
    const texKeys = keys.filter(k => /texture/i.test(k) && !/model/i.test(k));
    console.log(`  Texture field candidates: ${texKeys.join(', ')}`);

    // ItemDisplayInfo from @wowserhq/format uses numeric Texture fields
    // Check for array-based Texture field
    if ('Texture' in sampleRec && Array.isArray(sampleRec.Texture)) {
      console.log(`  Using array Texture field (length ${sampleRec.Texture.length})`);
    }
  }

  // Build set of unique (texName, regionIndex) pairs
  interface TexEntry { name: string; regionIdx: number; }
  const texSet = new Map<string, TexEntry>(); // key: "regionIdx:name"

  for (const rec of idiRecords) {
    let textures: string[];
    if (Array.isArray(rec.Texture)) {
      textures = rec.Texture;
    } else {
      // Try indexed fields
      textures = [];
      for (let i = 0; i < 8; i++) {
        const val = rec[`Texture_${i}`] ?? rec[`Texture_${i + 1}`] ?? rec[`Texture${i}`] ?? '';
        textures.push(val);
      }
    }

    for (let regionIdx = 0; regionIdx < 8; regionIdx++) {
      const texName = textures[regionIdx];
      if (!texName || texName === '') continue;
      const key = `${regionIdx}:${texName}`;
      if (!texSet.has(key)) {
        texSet.set(key, { name: texName, regionIdx });
      }
    }
  }

  console.log(`  ${texSet.size} unique (texture, region) pairs to extract.`);

  // Show per-region breakdown
  const regionCounts = new Map<number, number>();
  for (const entry of texSet.values()) {
    regionCounts.set(entry.regionIdx, (regionCounts.get(entry.regionIdx) || 0) + 1);
  }
  for (let i = 0; i < 8; i++) {
    console.log(`    ${REGION_BY_INDEX[i]}: ${regionCounts.get(i) || 0}`);
  }

  // --- Mount MPQ ---
  console.log('\nMounting texture.MPQ...');
  FS.mkdir('/stormjs');
  FS.mount(FS.filesystems.NODEFS, { root: resolve(DATA_DIR, 'model') }, '/stormjs');
  const mpq = await MPQ.open('/stormjs/texture.MPQ', 'r');

  // --- Ensure output dirs exist ---
  for (let i = 0; i < 8; i++) {
    mkdirSync(resolve(ROOT, 'public/item-textures', REGION_BY_INDEX[i]), { recursive: true });
  }

  // --- Extract textures ---
  let written = 0;
  let skipped = 0;
  let notFound = 0;
  let errors = 0;
  let processed = 0;
  const total = texSet.size;

  for (const entry of texSet.values()) {
    processed++;
    if (processed % 500 === 0) {
      console.log(`  [${processed}/${total}] ${written} written, ${skipped} skipped, ${notFound} not found, ${errors} errors`);
    }

    const regionDir = REGION_BY_INDEX[entry.regionIdx];
    const mpqRegion = REGION_MPQ_PATH[entry.regionIdx];
    const alreadyHasSuffix = endsWithGenderSuffix(entry.name);

    // Try each gender suffix (or as-is if name already has a suffix)
    const suffixesToTry = alreadyHasSuffix ? [''] : GENDER_SUFFIXES;

    for (const suffix of suffixesToTry) {
      const fullName = entry.name + suffix;
      const outPath = resolve(ROOT, 'public/item-textures', regionDir, `${fullName}.tex`);

      // Skip if .tex already exists (idempotent — merges with patch textures)
      if (existsSync(outPath)) {
        skipped++;
        continue;
      }

      // MPQ path: Item\TextureComponents\{Region}\{name}.blp
      const mpqPath = `Item\\TextureComponents\\${mpqRegion}\\${fullName}.blp`;

      try {
        if (!mpq.hasFile(mpqPath)) {
          notFound++;
          continue;
        }

        const file = mpq.openFile(mpqPath);
        const data = file.read();
        file.close();

        const blp = new Blp();
        blp.load(data);
        const image = blp.getImage(0, BLP_IMAGE_FORMAT.IMAGE_ABGR8888);
        const rgba = new Uint8Array(image.data);
        writeTexFile(outPath, image.width, image.height, rgba);
        written++;
      } catch (err: any) {
        errors++;
        if (errors <= 10) {
          console.error(`  ERROR: ${mpqPath} — ${err.message}`);
        }
      }
    }
  }

  mpq.close();

  // --- Summary ---
  console.log('\n=== Summary ===');
  console.log(`Processed:  ${processed} unique texture entries`);
  console.log(`Written:    ${written} .tex files`);
  console.log(`Skipped:    ${skipped} (already exist)`);
  console.log(`Not found:  ${notFound} (not in MPQ)`);
  console.log(`Errors:     ${errors}`);

  // Count total .tex files per region
  console.log('\nTotal .tex files per region (patch + newly extracted):');
  const { readdirSync } = await import('fs');
  for (let i = 0; i < 8; i++) {
    const dir = resolve(ROOT, 'public/item-textures', REGION_BY_INDEX[i]);
    const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.tex')) : [];
    console.log(`  ${REGION_BY_INDEX[i]}: ${files.length}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

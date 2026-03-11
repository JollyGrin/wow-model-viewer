/**
 * Patch existing model.json files with textureType data from M2 source files.
 *
 * This script reads the M2 binary files, parses the batch → textureLookup → textureTable
 * chain, and adds a `textureType` field to each group in the model.json manifest.
 *
 * Run this after fixing the data/ symlink:
 *   bun run scripts/patch-texture-types.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

interface M2Arr { count: number; ofs: number; }

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

function patchModel(model: CharacterModel) {
  const m2FullPath = resolve(ROOT, model.m2Path);
  const jsonPath = resolve(ROOT, 'public/models', model.slug, 'model.json');

  const buf = readFileSync(m2FullPath);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  function arr(off: number): M2Arr {
    return { count: view.getUint32(off, true), ofs: view.getUint32(off + 4, true) };
  }

  // Verify magic + version
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'MD20') throw new Error(`Bad magic: ${magic}`);
  const version = view.getUint32(4, true);
  if (version !== 256) throw new Error(`Bad version: ${version}`);

  // Parse header — same offsets as convert-model.ts
  let off = 8; // skip magic + version
  off += 8; // name
  off += 4; // globalFlags
  off += 8; // globalSequences
  off += 8; // animations
  off += 8; // animationLookup
  off += 8; // playableAnimLookup (v256 extra)
  off += 8; // bones
  off += 8; // keyBoneLookup
  off += 8; // vertices
  const viewsArr = arr(off); off += 8; // views
  off += 8; // colors
  const texturesArr = arr(off); off += 8; // textures
  off += 8; // transparency
  off += 8; // texAnims
  off += 8; // texReplace
  off += 8; // renderFlags
  off += 8; // boneLookup
  const texLookupArr = arr(off); // textureLookup

  // Parse texture types (16 bytes each)
  const texTypes: number[] = [];
  for (let t = 0; t < texturesArr.count; t++) {
    texTypes.push(view.getUint32(texturesArr.ofs + t * 16, true));
  }

  // Parse texture lookup (uint16 array)
  const texLookup: number[] = [];
  for (let t = 0; t < texLookupArr.count; t++) {
    texLookup.push(view.getUint16(texLookupArr.ofs + t * 2, true));
  }

  // Parse skin view0 submeshes + batches
  const viewOfs = viewsArr.ofs;
  const submeshesArr = arr(viewOfs + 24);
  const batchesArr = arr(viewOfs + 32);

  // Parse submeshes (32 bytes each)
  const submeshIds: number[] = [];
  for (let s = 0; s < submeshesArr.count; s++) {
    const so = submeshesArr.ofs + s * 32;
    submeshIds.push(view.getUint16(so, true));
  }

  // Parse batches (24 bytes each) → build submesh→textureType map
  const submeshTexType = new Map<number, number>();
  for (let b = 0; b < batchesArr.count; b++) {
    const bo = batchesArr.ofs + b * 24;
    const skinSectionIndex = view.getUint16(bo + 4, true);
    const texComboIndex = view.getUint16(bo + 16, true);

    if (submeshTexType.has(skinSectionIndex)) continue;
    if (texComboIndex < texLookup.length) {
      const texIdx = texLookup[texComboIndex];
      if (texIdx < texTypes.length) {
        submeshTexType.set(skinSectionIndex, texTypes[texIdx]);
      }
    }
  }

  // Read existing manifest
  const manifest = JSON.parse(readFileSync(jsonPath, 'utf-8'));

  // Patch groups with textureType
  // Groups in model.json map 1:1 to submeshes (filtered by indexCount > 0 && id !== 65535)
  let submeshIdx = 0;
  let patched = 0;
  for (const group of manifest.groups) {
    // Find matching submesh index (skip filtered submeshes)
    while (submeshIdx < submeshIds.length) {
      const so = submeshesArr.ofs + submeshIdx * 32;
      const id = view.getUint16(so, true);
      const indexCount = view.getUint16(so + 10, true);
      if (indexCount > 0 && id !== 65535 && id === group.id) break;
      submeshIdx++;
    }

    if (submeshIdx < submeshIds.length) {
      group.textureType = submeshTexType.get(submeshIdx) ?? -1;
      patched++;
      submeshIdx++;
    } else {
      group.textureType = -1;
    }
  }

  writeFileSync(jsonPath, JSON.stringify(manifest, null, 2));

  console.log(`  ${model.slug}: ${manifest.groups.length} groups, ${patched} patched`);
  console.log(`    texTypes: [${texTypes.join(', ')}]`);
  console.log(`    texLookup: [${texLookup.join(', ')}]`);
  console.log(`    batchCount: ${batchesArr.count}`);

  // Print texture type distribution
  const dist = new Map<number, number>();
  for (const g of manifest.groups) {
    const t = g.textureType ?? -1;
    dist.set(t, (dist.get(t) ?? 0) + 1);
  }
  console.log(`    textureType distribution: ${[...dist.entries()].map(([k, v]) => `${k}→${v}`).join(', ')}`);
}

console.log('Patching model.json files with textureType from M2 batch data...\n');

let success = 0;
let failed = 0;
for (const model of CHARACTER_MODELS) {
  try {
    patchModel(model);
    success++;
  } catch (e: any) {
    console.error(`  SKIP ${model.slug}: ${e.message}`);
    failed++;
  }
}

console.log(`\nDone: ${success} patched, ${failed} skipped`);

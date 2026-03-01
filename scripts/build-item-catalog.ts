/**
 * Build item catalog from converted assets.
 *
 * Reads:
 *   public/items/weapon/ — converted weapon slugs
 *   public/item-textures/ — to enumerate available .tex files per region
 *   data/dbc/ItemDisplayInfo.json — supplement multi-texture groupings (chest)
 *
 * Outputs: public/item-catalog.json
 *
 * Strategy:
 *   Weapons: read slugs from public/items/weapon/ directories
 *   Chest:   enumerate TorsoUpper .tex files, auto-link ArmUpper+TorsoLower by prefix
 *   Legs:    enumerate LegUpper .tex files (_Pant_LU or _Robe_LU), link LegLower
 *   Boots:   enumerate FootTexture .tex files
 *   Gloves:  enumerate HandTexture .tex files, link ArmLower
 *
 * Usage: bun run scripts/build-item-catalog.ts
 */

import { writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, extname, basename } from 'path';


const ROOT = resolve(import.meta.dirname, '..');

const TEX_DIR = resolve(ROOT, 'public/item-textures');

// --- Helpers ---

/** List .tex file stems in a region dir, stripping the gender/universal suffix.
 *  e.g. "Plate_A_01Silver_Chest_TU_U.tex" → "Plate_A_01Silver_Chest_TU" */
function listStems(regionDir: string): string[] {
  const dir = resolve(TEX_DIR, regionDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.tex'))
    .map(f => {
      let s = basename(f, extname(f)); // strip .tex
      // strip _U / _M / _F suffix
      if (/_[UMF]$/i.test(s)) s = s.slice(0, -2);
      return s;
    })
    .filter(s => s.length > 0);
}

/** Base path for equip texture resolver (no gender suffix, no .tex). */
function baseFor(regionDir: string, stem: string): string {
  return `/item-textures/${regionDir}/${stem}`;
}

/**
 * Extract the "item prefix" from a tex stem by stripping a known region suffix.
 * E.g. "Plate_A_01Silver_Chest_TU" → "Plate_A_01Silver" using suffix "_Chest_TU"
 */
function extractPrefix(stem: string, suffixes: string[]): string | null {
  const lower = stem.toLowerCase();
  for (const suf of suffixes) {
    if (lower.endsWith(suf.toLowerCase())) {
      return stem.slice(0, stem.length - suf.length);
    }
  }
  return null;
}

// --- Weapons ---

const weaponDir = resolve(ROOT, 'public/items/weapon');
const weaponSlugs: string[] = existsSync(weaponDir)
  ? readdirSync(weaponDir).filter(d => existsSync(resolve(weaponDir, d, 'model.json')))
  : [];
const weapons = weaponSlugs.map(slug => ({ slug, name: slug }));

// --- Chest (TorsoUpper is primary; link ArmUpper + TorsoLower by prefix) ---

interface ChestEntry  { name: string; torsoUpperBase: string; armUpperBase?: string; torsoLowerBase?: string; }
interface LegsEntry   { name: string; legUpperBase: string; legLowerBase?: string; }
interface BootsEntry  { name: string; footBase: string; }
interface GlovesEntry { name: string; handBase: string; armLowerBase?: string; }

const TU_SUFFIXES = ['_Chest_TU', '_Robe_TU'];
const AU_SUFFIXES = ['_Sleeve_AU'];
const TL_SUFFIXES = ['_Chest_TL', '_Robe_TL'];

// Build lookup sets for ArmUpper and TorsoLower by prefix
const auByPrefix = new Map<string, string>(); // prefix_lower → au_stem
const tlByPrefix = new Map<string, string>(); // prefix_lower → tl_stem

for (const stem of listStems('ArmUpperTexture')) {
  const prefix = extractPrefix(stem, AU_SUFFIXES);
  if (prefix) auByPrefix.set(prefix.toLowerCase(), stem);
}
for (const stem of listStems('TorsoLowerTexture')) {
  const prefix = extractPrefix(stem, TL_SUFFIXES);
  if (prefix) tlByPrefix.set(prefix.toLowerCase(), stem);
}

const chestMap = new Map<string, ChestEntry>();
for (const stem of listStems('TorsoUpperTexture')) {
  if (chestMap.has(stem)) continue;
  const entry: ChestEntry = { name: stem, torsoUpperBase: baseFor('TorsoUpperTexture', stem) };
  const prefix = extractPrefix(stem, TU_SUFFIXES);
  if (prefix) {
    const prefixLower = prefix.toLowerCase();
    const auStem = auByPrefix.get(prefixLower);
    const tlStem = tlByPrefix.get(prefixLower);
    if (auStem) entry.armUpperBase   = baseFor('ArmUpperTexture', auStem);
    if (tlStem) entry.torsoLowerBase = baseFor('TorsoLowerTexture', tlStem);
  }
  chestMap.set(stem, entry);
}

// --- Legs (LegUpper primary = _Pant_LU or _Robe_LU files; link LegLower) ---

const LU_PANT_SUFFIXES = ['_Pant_LU', '_Robe_LU'];
const LL_PANT_SUFFIXES = ['_Pant_LL', '_Robe_LL'];

// Build LegLower lookup by prefix
const llByPrefix = new Map<string, string>(); // prefix_lower → ll_stem
for (const stem of listStems('LegLowerTexture')) {
  const prefix = extractPrefix(stem, LL_PANT_SUFFIXES);
  if (prefix) llByPrefix.set(prefix.toLowerCase(), stem);
}

const legsMap = new Map<string, LegsEntry>();
for (const stem of listStems('LegUpperTexture')) {
  if (legsMap.has(stem)) continue;
  const prefix = extractPrefix(stem, LU_PANT_SUFFIXES);
  if (!prefix) continue; // skip _Belt_LU and non-matching patterns
  const entry: LegsEntry = { name: stem, legUpperBase: baseFor('LegUpperTexture', stem) };
  const llStem = llByPrefix.get(prefix.toLowerCase());
  if (llStem) entry.legLowerBase = baseFor('LegLowerTexture', llStem);
  legsMap.set(stem, entry);
}

// --- Boots (enumerate FootTexture directly) ---

const bootsMap = new Map<string, BootsEntry>();
for (const stem of listStems('FootTexture')) {
  if (!bootsMap.has(stem)) {
    bootsMap.set(stem, { name: stem, footBase: baseFor('FootTexture', stem) });
  }
}

// --- Gloves (HandTexture primary; link ArmLower by prefix) ---

const HA_SUFFIXES = ['_Glove_HA', '_Gauntlet_HA', '_HA'];
const AL_SUFFIXES = ['_Bracer_AL', '_Sleeve_AL'];

// Build ArmLower lookup by prefix
const alByPrefix = new Map<string, string>(); // prefix_lower → al_stem
for (const stem of listStems('ArmLowerTexture')) {
  const prefix = extractPrefix(stem, AL_SUFFIXES);
  if (prefix) alByPrefix.set(prefix.toLowerCase(), stem);
}

const glovesMap = new Map<string, GlovesEntry>();
for (const stem of listStems('HandTexture')) {
  if (glovesMap.has(stem)) continue;
  const entry: GlovesEntry = { name: stem, handBase: baseFor('HandTexture', stem) };
  const prefix = extractPrefix(stem, HA_SUFFIXES);
  if (prefix) {
    const alStem = alByPrefix.get(prefix.toLowerCase());
    if (alStem) entry.armLowerBase = baseFor('ArmLowerTexture', alStem);
  }
  glovesMap.set(stem, entry);
}

// --- Output ---

const catalog = {
  weapons,
  chest:  [...chestMap.values()],
  legs:   [...legsMap.values()],
  boots:  [...bootsMap.values()],
  gloves: [...glovesMap.values()],
};

writeFileSync(resolve(ROOT, 'public/item-catalog.json'), JSON.stringify(catalog, null, 2));

console.log('=== Item Catalog ===');
console.log(`Weapons: ${catalog.weapons.length}`);
console.log(`Chest:   ${catalog.chest.length}`);
console.log(`Legs:    ${catalog.legs.length}`);
console.log(`Boots:   ${catalog.boots.length}`);
console.log(`Gloves:  ${catalog.gloves.length}`);
console.log('\nWritten: public/item-catalog.json');

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

interface ChestEntry  { name: string; torsoUpperBase: string; armUpperBase?: string; torsoLowerBase?: string; sleeveGeoset?: number; robeGeoset?: number; }
interface LegsEntry   { name: string; legUpperBase: string; legLowerBase?: string; robeGeoset?: number; }
interface BootsEntry  { name: string; footBase: string; legLowerBase?: string; geosetValue: number; }
interface GlovesEntry { name: string; handBase: string; armLowerBase?: string; geosetValue: number; wristGeoset?: number; }

/**
 * Infer the GeosetGroup[0] variant (1–3) from a texture name prefix.
 *   1 → geoset x01 (simple, e.g. 501 for boots) — cloth/light items
 *   2 → geoset x02 (medium) — leather/mail
 *   3 → geoset x03 (heavy) — plate
 *
 * 0 is not returned — use that to signal "no override" if needed; callers can
 * decide to skip passing geoset=1 if that matches the naked default anyway.
 */
function inferGeosetValue(stem: string): number {
  const lower = stem.toLowerCase();
  if (lower.startsWith('plate_') || lower.startsWith('dk_') ||
      lower.startsWith('blaumeux') || lower.startsWith('tauren')) return 3;
  if (lower.startsWith('mail_') || lower.startsWith('chain_') ||
      lower.startsWith('leather_')) return 2;
  return 1; // cloth, robe, generic/unknown
}

/** Infer sleeve geoset for group 8. 0 = no sleeve geometry (cloth/other).
 *  2 → 802 (fitted sleeve, robes/leather), 3 → 803 (armored sleeve, plate/mail). */
function inferSleeveGeoset(stem: string): number {
  const lower = stem.toLowerCase();
  if (lower.startsWith('plate_') || lower.startsWith('dk_') ||
      lower.startsWith('mail_') || lower.startsWith('chain_')) return 3;
  if (lower.startsWith('robe_') || lower.startsWith('leather_')) return 2;
  return 0;
}

/** Infer wrist geoset for group 9. 0 = no wrist geometry (cloth/other).
 *  2 → 902 (leather bracers), 3 → 903 (armored bracers, plate/mail). */
function inferWristGeoset(stem: string): number {
  const lower = stem.toLowerCase();
  if (lower.startsWith('plate_') || lower.startsWith('dk_') ||
      lower.startsWith('mail_') || lower.startsWith('chain_')) return 3;
  if (lower.startsWith('leather_')) return 2;
  return 0;
}

/** Returns true if this stem represents a robe (long skirt geometry). */
function isRobe(stem: string): boolean {
  return stem.toLowerCase().startsWith('robe_');
}

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
  // Sleeve geoset: only set when arm texture exists and inference is non-zero
  if (entry.armUpperBase) {
    const sg = inferSleeveGeoset(stem);
    if (sg) entry.sleeveGeoset = sg;
  }
  // Robe geoset: robes get extended leg geometry (group 13 → 1302)
  if (isRobe(stem)) entry.robeGeoset = 2;
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
  // Robe legs get extended leg geometry (group 13 → 1302)
  if (stem.toLowerCase().includes('_robe_lu')) entry.robeGeoset = 2;
  legsMap.set(stem, entry);
}

// --- Boots (FootTexture primary; link LegLower by prefix for shin coverage) ---

const FO_SUFFIXES = ['_Boot_FO', '_Sabot_FO', '_FO'];
const LL_BOOT_SUFFIXES = ['_Boot_LL', '_LL'];

// Build LegLower lookup by boot prefix
const llBootByPrefix = new Map<string, string>(); // prefix_lower → ll_stem
for (const stem of listStems('LegLowerTexture')) {
  const prefix = extractPrefix(stem, LL_BOOT_SUFFIXES);
  if (prefix) llBootByPrefix.set(prefix.toLowerCase(), stem);
}

const bootsMap = new Map<string, BootsEntry>();
for (const stem of listStems('FootTexture')) {
  if (bootsMap.has(stem)) continue;
  const entry: BootsEntry = { name: stem, footBase: baseFor('FootTexture', stem), geosetValue: inferGeosetValue(stem) };
  const prefix = extractPrefix(stem, FO_SUFFIXES);
  if (prefix) {
    const prefixLower = prefix.toLowerCase();
    // Try _Boot_LL first, then fall back to pant/robe LL (some boots share LL textures)
    const llStem = llBootByPrefix.get(prefixLower) ?? llByPrefix.get(prefixLower);
    if (llStem) entry.legLowerBase = baseFor('LegLowerTexture', llStem);
  }
  bootsMap.set(stem, entry);
}

// --- Gloves (HandTexture primary; link ArmLower by prefix) ---

const HA_SUFFIXES = ['_Glove_HA', '_Gauntlet_HA', '_HA'];
const AL_SUFFIXES = ['_Glove_AL', '_Bracer_AL', '_Sleeve_AL', '_AL'];

// Build ArmLower lookup by prefix
const alByPrefix = new Map<string, string>(); // prefix_lower → al_stem
for (const stem of listStems('ArmLowerTexture')) {
  const prefix = extractPrefix(stem, AL_SUFFIXES);
  if (prefix) alByPrefix.set(prefix.toLowerCase(), stem);
}

const glovesMap = new Map<string, GlovesEntry>();
for (const stem of listStems('HandTexture')) {
  if (glovesMap.has(stem)) continue;
  const entry: GlovesEntry = { name: stem, handBase: baseFor('HandTexture', stem), geosetValue: inferGeosetValue(stem) };
  const prefix = extractPrefix(stem, HA_SUFFIXES);
  if (prefix) {
    const alStem = alByPrefix.get(prefix.toLowerCase());
    if (alStem) entry.armLowerBase = baseFor('ArmLowerTexture', alStem);
  }
  // Wrist geoset: only set when bracer/arm lower texture exists and inference is non-zero
  if (entry.armLowerBase) {
    const wg = inferWristGeoset(stem);
    if (wg) entry.wristGeoset = wg;
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

/**
 * Build game-item catalog from WoW item DB + ItemDisplayInfo + available textures.
 *
 * Joins:
 *   data/external/items.json         — itemId → name, displayId, quality, inventoryType
 *   data/dbc/ItemDisplayInfo.json    — displayId → Texture[0..7], GeosetGroup[0..2]
 *   public/item-textures/            — available .tex files per region
 *   public/items/weapon/             — available converted weapon M2s
 *
 * For each equippable item, checks if required textures are available.
 * Items without a DB match are kept as unnamed entries at the bottom.
 *
 * Outputs: public/item-catalog.json
 *
 * Usage: bun run scripts/build-item-catalog.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, extname, basename } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const TEX_DIR = resolve(ROOT, 'public/item-textures');

// --- Region constants ---

const REGIONS = [
  'ArmUpperTexture', 'ArmLowerTexture', 'HandTexture',
  'TorsoUpperTexture', 'TorsoLowerTexture',
  'LegUpperTexture', 'LegLowerTexture', 'FootTexture',
] as const;

// IDI Texture array indices → region dir
// 0=ArmUpper, 1=ArmLower, 2=Hand, 3=TorsoUpper, 4=TorsoLower, 5=LegUpper, 6=LegLower, 7=Foot

// inventoryType values for each slot
const CHEST_TYPES = new Set([5, 20]); // Chest + Robe
const LEGS_TYPES = new Set([7]);
const BOOTS_TYPES = new Set([8]);
const GLOVES_TYPES = new Set([10]);
const WEAPON_TYPES = new Set([13, 14, 15, 17, 21, 22, 25, 26]); // 1H, shield, bow, 2H, MH, OH, thrown, ranged

// Weapon subclass names (class=2)
const WEAPON_SUBCLASS: Record<number, string> = {
  0: 'Axe', 1: '2H Axe', 2: 'Bow', 3: 'Gun', 4: 'Mace', 5: '2H Mace',
  6: 'Polearm', 7: 'Sword', 8: '2H Sword', 10: 'Staff', 13: 'Fist',
  14: 'Misc', 15: 'Dagger', 16: 'Thrown', 17: 'Crossbow', 18: 'Wand',
};

// --- Helpers ---

/** List unique .tex stems in a region dir, stripping gender suffix. */
function listStems(regionDir: string): Set<string> {
  const dir = resolve(TEX_DIR, regionDir);
  if (!existsSync(dir)) return new Set();
  const stems = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.tex')) continue;
    let s = basename(f, extname(f));
    if (/_[UMF]$/i.test(s)) s = s.slice(0, -2);
    if (s.length > 0) stems.add(s);
  }
  return stems;
}

/** Base path for equip texture resolver (no gender suffix, no .tex). */
function baseFor(regionDir: string, stem: string): string {
  return `/item-textures/${regionDir}/${stem}`;
}

/** Extract item prefix by stripping a known region suffix. */
function extractPrefix(stem: string, suffixes: string[]): string | null {
  const lower = stem.toLowerCase();
  for (const suf of suffixes) {
    if (lower.endsWith(suf.toLowerCase())) {
      return stem.slice(0, stem.length - suf.length);
    }
  }
  return null;
}

// --- Suffix patterns for companion texture matching ---

const TU_SUFFIXES = ['_Chest_TU', '_Robe_TU'];
const AU_SUFFIXES = ['_Sleeve_AU'];
const TL_SUFFIXES = ['_Chest_TL', '_Robe_TL'];
const LU_SUFFIXES = ['_Pant_LU', '_Robe_LU'];
const LL_SUFFIXES = ['_Pant_LL', '_Robe_LL'];
const FO_SUFFIXES = ['_Boot_FO', '_Sabot_FO', '_FO'];
const LL_BOOT_SUFFIXES = ['_Boot_LL', '_LL'];
const HA_SUFFIXES = ['_Glove_HA', '_Gauntlet_HA', '_HA'];
const AL_SUFFIXES = ['_Glove_AL', '_Bracer_AL', '_Sleeve_AL', '_AL'];

// --- Load data sources ---

interface ItemRecord { itemId: number; name: string; displayId: number; inventoryType: number; quality: number; class: number; subclass: number; }
interface IDIRecord { ID: number; Texture: string[]; GeosetGroup: number[]; ModelName: string[]; ModelTexture: string[]; }

// Items DB
const itemsPath = resolve(ROOT, 'data/external/items.json');
const items: ItemRecord[] = existsSync(itemsPath) ? JSON.parse(readFileSync(itemsPath, 'utf-8')) : [];

// ItemDisplayInfo
const idiRaw = readFileSync(resolve(ROOT, 'data/dbc/ItemDisplayInfo.json'), 'utf-8');
const idiRecords: IDIRecord[] = JSON.parse(idiRaw.split('\n')[14]);
const idiByDisplayId = new Map<number, IDIRecord>();
for (const rec of idiRecords) idiByDisplayId.set(rec.ID, rec);

// --- Build available stem sets ---

const stemSets: Record<string, Set<string>> = {};
for (const r of REGIONS) stemSets[r] = listStems(r);

// --- Build companion texture lookups (prefix → stem) ---

function buildPrefixMap(regionDir: string, suffixes: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const stem of stemSets[regionDir]) {
    const prefix = extractPrefix(stem, suffixes);
    if (prefix) map.set(prefix.toLowerCase(), stem);
  }
  return map;
}

const auByPrefix = buildPrefixMap('ArmUpperTexture', AU_SUFFIXES);
const tlByPrefix = buildPrefixMap('TorsoLowerTexture', TL_SUFFIXES);
const llByPrefix = buildPrefixMap('LegLowerTexture', LL_SUFFIXES);
const llBootByPrefix = buildPrefixMap('LegLowerTexture', LL_BOOT_SUFFIXES);
const alByPrefix = buildPrefixMap('ArmLowerTexture', AL_SUFFIXES);

// --- Build weapon slug set ---

const weaponDir = resolve(ROOT, 'public/items/weapon');
const weaponSlugSet = new Set<string>();
if (existsSync(weaponDir)) {
  for (const d of readdirSync(weaponDir)) {
    if (existsSync(resolve(weaponDir, d, 'model.json'))) weaponSlugSet.add(d);
  }
}

// Map IDI ModelName stem (lowercase) → weapon slug
const modelNameToSlug = new Map<string, string>();
for (const slug of weaponSlugSet) {
  // Slug format: lowercase, hyphens. ModelName stem: mixed case, underscores.
  // Reverse: slug → possible stem patterns
  modelNameToSlug.set(slug, slug);
}

function findWeaponSlug(modelName: string): string | undefined {
  if (!modelName) return undefined;
  const stem = basename(modelName, extname(modelName));
  const slug = stem.toLowerCase().replace(/_/g, '-');
  if (weaponSlugSet.has(slug)) return slug;
  // Try prefix match (model might have color variant in slug)
  for (const s of weaponSlugSet) {
    if (s.startsWith(slug) || slug.startsWith(s)) return s;
  }
  return undefined;
}

// --- Build catalog entries from items DB ---

interface WeaponEntry { itemId: number; name: string; quality: number; slug: string; subclass?: string; }
interface ChestEntry  { itemId?: number; name: string; quality: number; torsoUpperBase: string; armUpperBase?: string; armLowerBase?: string; torsoLowerBase?: string; legUpperBase?: string; legLowerBase?: string; sleeveGeoset?: number; robeGeoset?: number; }
interface LegsEntry   { itemId?: number; name: string; quality: number; legUpperBase: string; legLowerBase?: string; robeGeoset?: number; }
interface BootsEntry  { itemId?: number; name: string; quality: number; footBase: string; legLowerBase?: string; geosetValue: number; }
interface GlovesEntry { itemId?: number; name: string; quality: number; handBase: string; armLowerBase?: string; geosetValue: number; wristGeoset?: number; }

/** Infer geoset value (1-3) from texture stem name as fallback when IDI GeosetGroup is 0. */
function inferGeosetValue(stem: string): number {
  const lower = stem.toLowerCase();
  if (lower.startsWith('plate_') || lower.startsWith('dk_') ||
      lower.startsWith('blaumeux') || lower.startsWith('tauren')) return 3;
  if (lower.startsWith('mail_') || lower.startsWith('chain_') ||
      lower.startsWith('leather_')) return 2;
  return 1;
}

function inferWristGeoset(stem: string): number {
  const lower = stem.toLowerCase();
  if (lower.startsWith('plate_') || lower.startsWith('dk_') ||
      lower.startsWith('mail_') || lower.startsWith('chain_')) return 3;
  if (lower.startsWith('leather_')) return 2;
  return 0;
}

/** Check if an IDI texture name is available in a region's stem set. */
function hasTex(regionIdx: number, texName: string): boolean {
  if (!texName) return false;
  return stemSets[REGIONS[regionIdx]].has(texName);
}

/** Build a chest entry from IDI texture data. */
function buildChestEntry(idi: IDIRecord, name: string, quality: number, itemId?: number): ChestEntry | null {
  const tuName = idi.Texture[3]; // TorsoUpper
  if (!tuName || !hasTex(3, tuName)) return null;

  const entry: ChestEntry = { name, quality, torsoUpperBase: baseFor('TorsoUpperTexture', tuName) };
  if (itemId !== undefined) entry.itemId = itemId;

  // Link companion textures via prefix matching
  const prefix = extractPrefix(tuName, TU_SUFFIXES);
  if (prefix) {
    const prefixLower = prefix.toLowerCase();
    const auStem = auByPrefix.get(prefixLower);
    const tlStem = tlByPrefix.get(prefixLower);
    if (auStem) entry.armUpperBase = baseFor('ArmUpperTexture', auStem);
    if (tlStem) entry.torsoLowerBase = baseFor('TorsoLowerTexture', tlStem);
  }

  // Geosets from IDI
  const gg = idi.GeosetGroup;
  if (gg[0] > 0) entry.sleeveGeoset = gg[0] + 1;
  if (gg[2] > 0) entry.robeGeoset = gg[2] + 1;

  // Robes provide leg + arm-lower textures that override equipped legs/gloves
  if (entry.robeGeoset) {
    const alName = idi.Texture[1]; // ArmLower
    const luName = idi.Texture[5]; // LegUpper
    const llName = idi.Texture[6]; // LegLower
    if (alName && hasTex(1, alName)) entry.armLowerBase = baseFor('ArmLowerTexture', alName);
    if (luName && hasTex(5, luName)) entry.legUpperBase = baseFor('LegUpperTexture', luName);
    if (llName && hasTex(6, llName)) entry.legLowerBase = baseFor('LegLowerTexture', llName);
  }

  return entry;
}

/** Build a legs entry from IDI texture data. */
function buildLegsEntry(idi: IDIRecord, name: string, quality: number, itemId?: number): LegsEntry | null {
  const luName = idi.Texture[5]; // LegUpper
  if (!luName || !hasTex(5, luName)) return null;

  const entry: LegsEntry = { name, quality, legUpperBase: baseFor('LegUpperTexture', luName) };
  if (itemId !== undefined) entry.itemId = itemId;

  const prefix = extractPrefix(luName, LU_SUFFIXES);
  if (prefix) {
    const llStem = llByPrefix.get(prefix.toLowerCase());
    if (llStem) entry.legLowerBase = baseFor('LegLowerTexture', llStem);
  }

  if (idi.GeosetGroup[2] > 0) entry.robeGeoset = idi.GeosetGroup[2] + 1;

  return entry;
}

/** Build a boots entry from IDI texture data. */
function buildBootsEntry(idi: IDIRecord, name: string, quality: number, itemId?: number): BootsEntry | null {
  const foName = idi.Texture[7]; // Foot
  if (!foName || !hasTex(7, foName)) return null;

  const gg0 = idi.GeosetGroup[0];
  const geosetValue = gg0 > 0 ? gg0 + 1 : inferGeosetValue(foName);

  const entry: BootsEntry = { name, quality, footBase: baseFor('FootTexture', foName), geosetValue };
  if (itemId !== undefined) entry.itemId = itemId;

  // LegLower companion: try IDI Texture[6] first, then prefix heuristic
  const llName = idi.Texture[6];
  if (llName && hasTex(6, llName)) {
    entry.legLowerBase = baseFor('LegLowerTexture', llName);
  } else {
    const prefix = extractPrefix(foName, FO_SUFFIXES);
    if (prefix) {
      const prefixLower = prefix.toLowerCase();
      const llStem = llBootByPrefix.get(prefixLower) ?? llByPrefix.get(prefixLower);
      if (llStem) entry.legLowerBase = baseFor('LegLowerTexture', llStem);
    }
  }

  return entry;
}

/** Build a gloves entry from IDI texture data. */
function buildGlovesEntry(idi: IDIRecord, name: string, quality: number, itemId?: number): GlovesEntry | null {
  const haName = idi.Texture[2]; // Hand
  if (!haName || !hasTex(2, haName)) return null;

  const gg0 = idi.GeosetGroup[0];
  const geosetValue = gg0 > 0 ? gg0 + 1 : inferGeosetValue(haName);

  const entry: GlovesEntry = { name, quality, handBase: baseFor('HandTexture', haName), geosetValue };
  if (itemId !== undefined) entry.itemId = itemId;

  // ArmLower companion: try IDI Texture[1] first, then prefix heuristic
  const alName = idi.Texture[1];
  if (alName && hasTex(1, alName)) {
    entry.armLowerBase = baseFor('ArmLowerTexture', alName);
  } else {
    const prefix = extractPrefix(haName, HA_SUFFIXES);
    if (prefix) {
      const alStem = alByPrefix.get(prefix.toLowerCase());
      if (alStem) entry.armLowerBase = baseFor('ArmLowerTexture', alStem);
    }
  }

  // Wrist geoset: prefer IDI GeosetGroup[1], fall back to inference
  const gg1 = idi.GeosetGroup[1];
  if (gg1 > 0) {
    entry.wristGeoset = gg1 + 1;
  } else if (entry.armLowerBase) {
    const wg = inferWristGeoset(haName);
    if (wg) entry.wristGeoset = wg;
  }

  return entry;
}

// --- Process items from DB ---

const weapons: WeaponEntry[] = [];
const chestItems: ChestEntry[] = [];
const legsItems: LegsEntry[] = [];
const bootsItems: BootsEntry[] = [];
const glovesItems: GlovesEntry[] = [];

// Track which IDI textures have been claimed by DB items
const claimedChest = new Set<string>();  // TorsoUpper stem
const claimedLegs = new Set<string>();   // LegUpper stem
const claimedBoots = new Set<string>();  // Foot stem
const claimedGloves = new Set<string>(); // Hand stem

let dbMatched = 0;
let dbNoIdi = 0;
let dbNoTex = 0;

for (const item of items) {
  const idi = idiByDisplayId.get(item.displayId);
  if (!idi) { dbNoIdi++; continue; }

  if (WEAPON_TYPES.has(item.inventoryType)) {
    const slug = findWeaponSlug(idi.ModelName[0]);
    if (slug) {
      const subclass = item.class === 2 ? WEAPON_SUBCLASS[item.subclass] : undefined;
      weapons.push({ itemId: item.itemId, name: item.name, quality: item.quality, slug, subclass });
      dbMatched++;
    } else {
      dbNoTex++;
    }
  } else if (CHEST_TYPES.has(item.inventoryType)) {
    const entry = buildChestEntry(idi, item.name, item.quality, item.itemId);
    if (entry) {
      chestItems.push(entry);
      claimedChest.add(idi.Texture[3]);
      dbMatched++;
    } else { dbNoTex++; }
  } else if (LEGS_TYPES.has(item.inventoryType)) {
    const entry = buildLegsEntry(idi, item.name, item.quality, item.itemId);
    if (entry) {
      legsItems.push(entry);
      claimedLegs.add(idi.Texture[5]);
      dbMatched++;
    } else { dbNoTex++; }
  } else if (BOOTS_TYPES.has(item.inventoryType)) {
    const entry = buildBootsEntry(idi, item.name, item.quality, item.itemId);
    if (entry) {
      bootsItems.push(entry);
      claimedBoots.add(idi.Texture[7]);
      dbMatched++;
    } else { dbNoTex++; }
  } else if (GLOVES_TYPES.has(item.inventoryType)) {
    const entry = buildGlovesEntry(idi, item.name, item.quality, item.itemId);
    if (entry) {
      glovesItems.push(entry);
      claimedGloves.add(idi.Texture[2]);
      dbMatched++;
    } else { dbNoTex++; }
  }
}

// --- Add unclaimed textures as unnamed entries (quality 0) ---
// These are TBC-era or patch textures not in the vanilla item DB.

let unclaimedCount = 0;

for (const idi of idiRecords) {
  // Chest
  const tu = idi.Texture[3];
  if (tu && hasTex(3, tu) && !claimedChest.has(tu)) {
    const entry = buildChestEntry(idi, tu, 0);
    if (entry) { chestItems.push(entry); unclaimedCount++; claimedChest.add(tu); }
  }
  // Legs
  const lu = idi.Texture[5];
  if (lu && hasTex(5, lu) && !claimedLegs.has(lu)) {
    const entry = buildLegsEntry(idi, lu, 0);
    if (entry) { legsItems.push(entry); unclaimedCount++; claimedLegs.add(lu); }
  }
  // Boots
  const fo = idi.Texture[7];
  if (fo && hasTex(7, fo) && !claimedBoots.has(fo)) {
    const entry = buildBootsEntry(idi, fo, 0);
    if (entry) { bootsItems.push(entry); unclaimedCount++; claimedBoots.add(fo); }
  }
  // Gloves
  const ha = idi.Texture[2];
  if (ha && hasTex(2, ha) && !claimedGloves.has(ha)) {
    const entry = buildGlovesEntry(idi, ha, 0);
    if (entry) { glovesItems.push(entry); unclaimedCount++; claimedGloves.add(ha); }
  }
}

// Also add weapon slugs not claimed by any DB item
const claimedWeaponSlugs = new Set(weapons.map(w => w.slug));
for (const slug of weaponSlugSet) {
  if (!claimedWeaponSlugs.has(slug)) {
    weapons.push({ itemId: 0, name: slug, quality: 0, slug });
    unclaimedCount++;
  }
}

// --- Sort: quality desc, then name asc ---

function sortItems<T extends { quality: number; name: string }>(arr: T[]): T[] {
  return arr.sort((a, b) => b.quality - a.quality || a.name.localeCompare(b.name));
}

const catalog = {
  weapons: sortItems(weapons),
  chest:   sortItems(chestItems),
  legs:    sortItems(legsItems),
  boots:   sortItems(bootsItems),
  gloves:  sortItems(glovesItems),
};

writeFileSync(resolve(ROOT, 'public/item-catalog.json'), JSON.stringify(catalog));

console.log('=== Game Item Catalog ===');
console.log(`Weapons: ${catalog.weapons.length} (${weapons.filter(w => w.itemId).length} named)`);
console.log(`Chest:   ${catalog.chest.length} (${chestItems.filter(c => c.itemId).length} named)`);
console.log(`Legs:    ${catalog.legs.length} (${legsItems.filter(l => l.itemId).length} named)`);
console.log(`Boots:   ${catalog.boots.length} (${bootsItems.filter(b => b.itemId).length} named)`);
console.log(`Gloves:  ${catalog.gloves.length} (${glovesItems.filter(g => g.itemId).length} named)`);
console.log(`\nDB matched: ${dbMatched}, No IDI: ${dbNoIdi}, No textures: ${dbNoTex}`);
console.log(`Unclaimed (unnamed): ${unclaimedCount}`);
console.log('\nWritten: public/item-catalog.json');

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
const WEAPON_TYPES = new Set([13, 15, 17, 21, 22, 25, 26]); // 1H, bow, 2H, MH, OH, thrown, ranged
const SHIELD_TYPES = new Set([14]); // Shield
const HEAD_TYPES = new Set([1]);      // Head slot
const SHOULDER_TYPES = new Set([3]);  // Shoulder slot

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
interface IDIRecord { ID: number; Texture: string[]; GeosetGroup: number[]; ModelName: string[]; ModelTexture: string[]; HelmetGeosetVisID: number[]; }

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

// --- Build helmet slug set (with available race-gender variants) ---
const headDir = resolve(ROOT, 'public/items/head');
const helmetSlugSet = new Set<string>();
const helmetVariants = new Map<string, string[]>(); // slug → available race-gender slugs
if (existsSync(headDir)) {
  for (const d of readdirSync(headDir)) {
    const slugDir = resolve(headDir, d);
    try {
      const subs = readdirSync(slugDir);
      const variants: string[] = [];
      for (const s of subs) {
        if (s === 'textures') continue;
        if (existsSync(resolve(slugDir, s, 'model.json'))) variants.push(s);
      }
      if (variants.length > 0) {
        helmetSlugSet.add(d);
        helmetVariants.set(d, variants.sort());
      }
    } catch { /* not a directory */ }
  }
}

// --- Build shoulder slug set ---
const shoulderDir = resolve(ROOT, 'public/items/shoulder');
const shoulderSlugSet = new Map<string, boolean>(); // slug → hasRight
if (existsSync(shoulderDir)) {
  for (const d of readdirSync(shoulderDir)) {
    const leftJson = resolve(shoulderDir, d, 'left', 'model.json');
    if (existsSync(leftJson)) {
      const hasRight = existsSync(resolve(shoulderDir, d, 'right', 'model.json'));
      shoulderSlugSet.set(d, hasRight);
    }
  }
}

// --- Build shield slug set ---
const shieldDir = resolve(ROOT, 'public/items/shield');
const shieldSlugSet = new Set<string>();
if (existsSync(shieldDir)) {
  for (const d of readdirSync(shieldDir)) {
    if (existsSync(resolve(shieldDir, d, 'model.json'))) shieldSlugSet.add(d);
  }
}

// Map IDI ModelName stem (lowercase) → weapon slug
const modelNameToSlug = new Map<string, string>();
for (const slug of weaponSlugSet) {
  // Slug format: lowercase, hyphens. ModelName stem: mixed case, underscores.
  // Reverse: slug → possible stem patterns
  modelNameToSlug.set(slug, slug);
}

function findHelmetSlug(modelName: string): string | undefined {
  if (!modelName) return undefined;
  const stem = basename(modelName, extname(modelName)); // e.g., Helm_Plate_D_02
  const slug = stem.toLowerCase().replace(/_/g, '-');
  if (helmetSlugSet.has(slug)) return slug;
  return undefined;
}

function findShoulderSlug(modelName: string): string | undefined {
  if (!modelName) return undefined;
  const stem = basename(modelName, extname(modelName)); // e.g., LShoulder_Plate_D_03
  // Strip L/RShoulder_ prefix
  const baseStem = stem.replace(/^[LR]Shoulder_/i, '');
  const slug = baseStem.toLowerCase().replace(/_/g, '-');
  if (shoulderSlugSet.has(slug)) return slug;
  return undefined;
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

function findShieldSlug(modelName: string): string | undefined {
  if (!modelName) return undefined;
  const stem = basename(modelName, extname(modelName));
  const slug = stem.toLowerCase().replace(/_/g, '-');
  if (shieldSlugSet.has(slug)) return slug;
  for (const s of shieldSlugSet) {
    if (s.startsWith(slug) || slug.startsWith(s)) return s;
  }
  return undefined;
}

// --- Texture slug helpers ---

/** Convert a BLP/ModelTexture name to a tex slug (lowercase, underscores to hyphens). */
function toTexSlug(texName: string): string {
  return texName.toLowerCase().replace(/_/g, '-');
}

/** Get the tex slug for an IDI record's ModelTexture[0], verified against disk.
 *  Falls back to first available texture if the IDI texture doesn't exist. */
function idiTexSlugVerified(idi: IDIRecord, itemType: string, slug: string): string {
  const mt = idi.ModelTexture?.[0];
  if (mt) {
    const ts = toTexSlug(mt);
    const texPath = resolve(ROOT, 'public/items', itemType, slug, 'textures', `${ts}.tex`);
    if (existsSync(texPath)) return ts;
  }
  return firstAvailableTex(itemType, slug);
}

/** Pick the first available .tex file from a slug's textures/ dir. */
function firstAvailableTex(itemType: string, slug: string): string {
  const texDir = resolve(ROOT, 'public/items', itemType, slug, 'textures');
  if (!existsSync(texDir)) return '';
  for (const f of readdirSync(texDir)) {
    if (f.endsWith('.tex') && f !== 'main.tex') {
      return basename(f, '.tex');
    }
  }
  // Fallback to main.tex if that's all there is
  if (existsSync(resolve(texDir, 'main.tex'))) return 'main';
  return '';
}

// --- Build catalog entries from items DB ---

interface WeaponEntry { itemId: number; name: string; quality: number; slug: string; texture: string; subclass?: string; }
interface ChestEntry  { itemId?: number; name: string; quality: number; torsoUpperBase: string; armUpperBase?: string; armLowerBase?: string; torsoLowerBase?: string; legUpperBase?: string; legLowerBase?: string; sleeveGeoset?: number; robeGeoset?: number; }
interface LegsEntry   { itemId?: number; name: string; quality: number; legUpperBase: string; legLowerBase?: string; robeGeoset?: number; }
interface BootsEntry  { itemId?: number; name: string; quality: number; footBase: string; legLowerBase?: string; geosetValue: number; }
interface GlovesEntry { itemId?: number; name: string; quality: number; handBase: string; armLowerBase?: string; geosetValue: number; wristGeoset?: number; }
interface HelmetEntry { itemId?: number; name: string; quality: number; slug: string; texture: string; helmetGeosetVisID: [number, number]; variants: string[]; }
interface ShoulderEntry { itemId?: number; name: string; quality: number; slug: string; texture: string; hasRight: boolean; }
interface ShieldEntry { itemId?: number; name: string; quality: number; slug: string; texture: string; subclass?: string; }

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
const shieldItems: ShieldEntry[] = [];
const helmetItems: HelmetEntry[] = [];
const shoulderItems: ShoulderEntry[] = [];
const chestItems: ChestEntry[] = [];
const legsItems: LegsEntry[] = [];
const bootsItems: BootsEntry[] = [];
const glovesItems: GlovesEntry[] = [];

// Track which items have been claimed by DB items
const claimedHelmets = new Set<string>();   // helmet slug
const claimedShoulders = new Set<string>(); // shoulder slug
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

  if (HEAD_TYPES.has(item.inventoryType)) {
    const slug = findHelmetSlug(idi.ModelName[0]);
    if (slug) {
      const visID = idi.HelmetGeosetVisID ?? [0, 0];
      helmetItems.push({ itemId: item.itemId, name: item.name, quality: item.quality, slug, texture: idiTexSlugVerified(idi, 'head', slug), helmetGeosetVisID: [visID[0], visID[1]], variants: helmetVariants.get(slug) ?? [] });
      claimedHelmets.add(slug);
      dbMatched++;
    } else { dbNoTex++; }
  } else if (SHOULDER_TYPES.has(item.inventoryType)) {
    const slug = findShoulderSlug(idi.ModelName[0]);
    if (slug) {
      shoulderItems.push({ itemId: item.itemId, name: item.name, quality: item.quality, slug, texture: idiTexSlugVerified(idi, 'shoulder', slug), hasRight: shoulderSlugSet.get(slug) ?? false });
      claimedShoulders.add(slug);
      dbMatched++;
    } else { dbNoTex++; }
  } else if (SHIELD_TYPES.has(item.inventoryType)) {
    const slug = findShieldSlug(idi.ModelName[0]);
    if (slug) {
      const subclass = item.class === 4 ? 'Shield' : undefined;
      shieldItems.push({ itemId: item.itemId, name: item.name, quality: item.quality, slug, texture: idiTexSlugVerified(idi, 'shield', slug), subclass });
      dbMatched++;
    } else { dbNoTex++; }
  } else if (WEAPON_TYPES.has(item.inventoryType)) {
    const slug = findWeaponSlug(idi.ModelName[0]);
    if (slug) {
      const subclass = item.class === 2 ? WEAPON_SUBCLASS[item.subclass] : undefined;
      weapons.push({ itemId: item.itemId, name: item.name, quality: item.quality, slug, texture: idiTexSlugVerified(idi, 'weapon', slug), subclass });
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

// Also add unclaimed helmet/shoulder/weapon slugs not matched by any DB item

// Helmets: scan IDI for unclaimed slugs
for (const idi of idiRecords) {
  const modelName = idi.ModelName?.[0];
  if (!modelName) continue;
  const slug = findHelmetSlug(modelName);
  if (slug && !claimedHelmets.has(slug)) {
    const visID = idi.HelmetGeosetVisID ?? [0, 0];
    helmetItems.push({ name: slug, quality: 0, slug, texture: idiTexSlugVerified(idi, 'head', slug), helmetGeosetVisID: [visID[0], visID[1]], variants: helmetVariants.get(slug) ?? [] });
    claimedHelmets.add(slug);
    unclaimedCount++;
  }
}
// Helmets without any IDI match
for (const slug of helmetSlugSet) {
  if (!claimedHelmets.has(slug)) {
    helmetItems.push({ name: slug, quality: 0, slug, texture: firstAvailableTex('head', slug), helmetGeosetVisID: [0, 0], variants: helmetVariants.get(slug) ?? [] });
    unclaimedCount++;
  }
}

// Shoulders: scan IDI for unclaimed slugs
for (const idi of idiRecords) {
  const modelName = idi.ModelName?.[0];
  if (!modelName) continue;
  const slug = findShoulderSlug(modelName);
  if (slug && !claimedShoulders.has(slug)) {
    shoulderItems.push({ name: slug, quality: 0, slug, texture: idiTexSlugVerified(idi, 'shoulder', slug), hasRight: shoulderSlugSet.get(slug) ?? false });
    claimedShoulders.add(slug);
    unclaimedCount++;
  }
}
// Shoulders without any IDI match
for (const slug of shoulderSlugSet.keys()) {
  if (!claimedShoulders.has(slug)) {
    shoulderItems.push({ name: slug, quality: 0, slug, texture: firstAvailableTex('shoulder', slug), hasRight: shoulderSlugSet.get(slug) ?? false });
    unclaimedCount++;
  }
}

// Weapons
const claimedWeaponSlugs = new Set(weapons.map(w => w.slug));
for (const slug of weaponSlugSet) {
  if (!claimedWeaponSlugs.has(slug)) {
    weapons.push({ itemId: 0, name: slug, quality: 0, slug, texture: firstAvailableTex('weapon', slug) });
    unclaimedCount++;
  }
}

// Shields
const claimedShieldSlugs = new Set(shieldItems.map(s => s.slug));
for (const slug of shieldSlugSet) {
  if (!claimedShieldSlugs.has(slug)) {
    shieldItems.push({ name: slug, quality: 0, slug, texture: firstAvailableTex('shield', slug) });
    unclaimedCount++;
  }
}

// --- Sort: quality desc, then name asc ---

function sortItems<T extends { quality: number; name: string }>(arr: T[]): T[] {
  return arr.sort((a, b) => b.quality - a.quality || a.name.localeCompare(b.name));
}

const catalog = {
  weapons:   sortItems(weapons),
  shields:   sortItems(shieldItems),
  helmets:   sortItems(helmetItems),
  shoulders: sortItems(shoulderItems),
  chest:     sortItems(chestItems),
  legs:      sortItems(legsItems),
  boots:     sortItems(bootsItems),
  gloves:    sortItems(glovesItems),
};

writeFileSync(resolve(ROOT, 'public/item-catalog.json'), JSON.stringify(catalog));

console.log('=== Game Item Catalog ===');
console.log(`Weapons:   ${catalog.weapons.length} (${weapons.filter(w => w.itemId).length} named)`);
console.log(`Shields:   ${catalog.shields.length} (${shieldItems.filter(s => s.itemId).length} named)`);
console.log(`Helmets:   ${catalog.helmets.length} (${helmetItems.filter(h => h.itemId).length} named)`);
console.log(`Shoulders: ${catalog.shoulders.length} (${shoulderItems.filter(s => s.itemId).length} named)`);
console.log(`Chest:     ${catalog.chest.length} (${chestItems.filter(c => c.itemId).length} named)`);
console.log(`Legs:      ${catalog.legs.length} (${legsItems.filter(l => l.itemId).length} named)`);
console.log(`Boots:     ${catalog.boots.length} (${bootsItems.filter(b => b.itemId).length} named)`);
console.log(`Gloves:    ${catalog.gloves.length} (${glovesItems.filter(g => g.itemId).length} named)`);
console.log(`\nDB matched: ${dbMatched}, No IDI: ${dbNoIdi}, No textures: ${dbNoTex}`);
console.log(`Unclaimed (unnamed): ${unclaimedCount}`);
console.log('\nWritten: public/item-catalog.json');

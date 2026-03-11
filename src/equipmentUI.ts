/**
 * Equipment UI — WoW-style item picker with quality colors and search.
 *
 * Loads /item-catalog.json (game items with names + quality),
 * builds per-slot searchable selects, exposes state accessors.
 */

import type { BodyArmor } from './loadModel';
import { assetUrl } from './assetBase';

// --- Quality colors (WoW standard) ---
const QUALITY_COLOR: Record<number, string> = {
  0: '#9d9d9d', // Poor (gray)
  1: '#ffffff', // Common (white)
  2: '#1eff00', // Uncommon (green)
  3: '#0070dd', // Rare (blue)
  4: '#a335ee', // Epic (purple)
  5: '#ff8000', // Legendary (orange)
};

// --- Catalog types ---

interface WeaponEntry   { itemId: number; name: string; quality: number; slug: string; texture: string; subclass?: string; }
interface HelmetEntry   { itemId?: number; name: string; quality: number; slug: string; texture: string; helmetGeosetVisID: [number, number]; variants: string[]; }
interface ShoulderEntry { itemId?: number; name: string; quality: number; slug: string; texture: string; hasRight: boolean; }
interface ChestEntry    { itemId?: number; name: string; quality: number; torsoUpperBase: string; armUpperBase?: string; armLowerBase?: string; torsoLowerBase?: string; legUpperBase?: string; legLowerBase?: string; sleeveGeoset?: number; robeGeoset?: number; }
interface LegsEntry     { itemId?: number; name: string; quality: number; legUpperBase: string; legLowerBase?: string; robeGeoset?: number; }
interface BootsEntry    { itemId?: number; name: string; quality: number; footBase: string; legLowerBase?: string; geosetValue: number; }
interface GlovesEntry   { itemId?: number; name: string; quality: number; handBase: string; armLowerBase?: string; geosetValue: number; wristGeoset?: number; }

interface ShieldEntry  { itemId?: number; name: string; quality: number; slug: string; texture: string; subclass?: string; }

/** Combined offhand entry — can be a weapon or a shield. */
type OffhandEntry = (WeaponEntry | ShieldEntry) & { _type: 'weapon' | 'shield' };

interface ItemCatalog {
  weapons:   WeaponEntry[];
  shields:   ShieldEntry[];
  helmets:   HelmetEntry[];
  shoulders: ShoulderEntry[];
  chest:     ChestEntry[];
  legs:      LegsEntry[];
  boots:     BootsEntry[];
  gloves:    GlovesEntry[];
}

let catalog: ItemCatalog | null = null;

// Active selections
const selection: {
  weapon?: WeaponEntry;
  offhand?: OffhandEntry;
  helmet?: HelmetEntry;
  shoulder?: ShoulderEntry;
  chest?: ChestEntry;
  legs?: LegsEntry;
  boots?: BootsEntry;
  gloves?: GlovesEntry;
} = {};

export function getWeaponPath(): string | undefined {
  if (!selection.weapon) return undefined;
  return `/items/weapon/${selection.weapon.slug}`;
}

export function getWeaponTexture(): string | undefined {
  if (!selection.weapon?.texture) return undefined;
  return `/items/weapon/${selection.weapon.slug}/textures/${selection.weapon.texture}.tex`;
}

export function getOffhandPath(): string | undefined {
  if (!selection.offhand) return undefined;
  const dir = selection.offhand._type === 'shield' ? 'shield' : 'weapon';
  return `/items/${dir}/${selection.offhand.slug}`;
}

export function getOffhandTexture(): string | undefined {
  if (!selection.offhand?.texture) return undefined;
  const dir = selection.offhand._type === 'shield' ? 'shield' : 'weapon';
  return `/items/${dir}/${selection.offhand.slug}/textures/${selection.offhand.texture}.tex`;
}

export function getArmorOptions(): BodyArmor | undefined {
  const armor: BodyArmor = {};

  // --- Helmet ---
  if (selection.helmet) {
    armor.helmet = selection.helmet.slug;
    armor.helmetGeosetVisID = selection.helmet.helmetGeosetVisID;
    armor.helmetTexture = selection.helmet.texture;
  }

  // --- Shoulders ---
  if (selection.shoulder) {
    armor.shoulderSlug = selection.shoulder.slug;
    armor.shoulderHasRight = selection.shoulder.hasRight;
    armor.shoulderTexture = selection.shoulder.texture;
  }

  // --- Layer 5: Chest ---
  if (selection.chest) {
    armor.armUpperBase   = selection.chest.armUpperBase;
    armor.torsoUpperBase = selection.chest.torsoUpperBase;
    armor.torsoLowerBase = selection.chest.torsoLowerBase;
    armor.sleeveGeoset   = selection.chest.sleeveGeoset || undefined;
    armor.robeGeoset     = selection.chest.robeGeoset || undefined;

    // Robes provide leg + arm-lower textures as base
    if (armor.robeGeoset) {
      armor.legUpperBase = selection.chest.legUpperBase;
      armor.legLowerBase = selection.chest.legLowerBase;
      armor.armLowerBase = selection.chest.armLowerBase;
    }
  }

  // --- Layer 7: Legs (override chest leg textures for non-robe) ---
  if (selection.legs) {
    if (!armor.robeGeoset) {
      armor.legUpperBase = selection.legs.legUpperBase;
      if (selection.legs.legLowerBase) armor.legLowerBase = selection.legs.legLowerBase;
      if (selection.legs.robeGeoset) armor.robeGeoset = selection.legs.robeGeoset;
    }
  }

  const isDress = !!armor.robeGeoset;

  // --- Layer 8: Boots (footGeoset always; legLower overrides legs) ---
  if (selection.boots) {
    armor.footBase = selection.boots.footBase;
    armor.footGeoset = selection.boots.geosetValue || undefined;
    if (!isDress && selection.boots.legLowerBase) {
      armor.legLowerBase = selection.boots.legLowerBase;
    }
  }

  // --- Layer 10: Gloves (armLower overrides chest/robe) ---
  if (selection.gloves) {
    armor.handBase   = selection.gloves.handBase;
    armor.handGeoset = selection.gloves.geosetValue || undefined;
    if (selection.gloves.armLowerBase) {
      armor.armLowerBase = selection.gloves.armLowerBase;
    }
    if (!isDress) {
      armor.wristGeoset = selection.gloves.wristGeoset || undefined;
    }
  }

  const hasAny = Object.values(armor).some(v => v);
  return hasAny ? armor : undefined;
}

// --- Display name helpers ---

function weaponDisplayName(w: WeaponEntry): string {
  if (!w.itemId) return w.slug;
  return w.subclass ? `[${w.subclass}] ${w.name}` : w.name;
}

function offhandDisplayName(o: OffhandEntry): string {
  const prefix = o._type === 'shield' ? '[Shield]' : (o as WeaponEntry).subclass ? `[${(o as WeaponEntry).subclass}]` : '[Weapon]';
  return `${prefix} ${o.name}`;
}

function itemDisplayName(item: { itemId?: number; name: string }): string {
  return item.name;
}

// --- Filtered select builder ---

/** Build a select + search input pair. Returns the container div. */
function buildFilteredSelect<T extends { name: string; quality: number }>(
  id: string,
  items: T[],
  displayFn: (item: T) => string,
  onSelect: (entry: T | undefined) => void,
): { container: HTMLDivElement; select: HTMLSelectElement } {
  const container = document.createElement('div');
  container.className = 'equip-select-wrap';

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'equip-search';
  search.placeholder = 'Search...';

  const sel = document.createElement('select');
  sel.id = id;
  sel.size = 8;

  function populateOptions(filter: string) {
    sel.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'None';
    noneOpt.style.color = '#888';
    sel.appendChild(noneOpt);

    const lowerFilter = filter.toLowerCase();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const display = displayFn(item);
      if (lowerFilter && !display.toLowerCase().includes(lowerFilter)) continue;
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = display;
      opt.style.color = QUALITY_COLOR[item.quality] || QUALITY_COLOR[1];
      sel.appendChild(opt);
    }
  }

  populateOptions('');

  search.addEventListener('input', () => {
    populateOptions(search.value);
  });

  sel.addEventListener('change', () => {
    if (sel.value === '') {
      onSelect(undefined);
    } else {
      onSelect(items[parseInt(sel.value, 10)]);
    }
  });

  container.appendChild(search);
  container.appendChild(sel);
  return { container, select: sel };
}

function makeRow(label: string, selectContainer: HTMLDivElement, select: HTMLSelectElement, diceSlot: string, onChange: () => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'equip-row';

  const header = document.createElement('div');
  header.className = 'equip-row-header';

  const lbl = document.createElement('span');
  lbl.className = 'equip-label';
  lbl.textContent = label;

  const btn = document.createElement('button');
  btn.className = 'equip-dice';
  btn.dataset.slot = diceSlot;
  btn.textContent = '\u{1F3B2}';
  btn.title = `Random ${label}`;
  btn.addEventListener('click', () => {
    randomizeSlot(select, onChange);
  });

  header.appendChild(lbl);
  header.appendChild(btn);

  row.appendChild(header);
  row.appendChild(selectContainer);
  return row;
}

function randomizeSlot(sel: HTMLSelectElement, onChange: () => void) {
  const opts = Array.from(sel.options).filter(o => o.value !== '');
  if (opts.length === 0) return;
  const pick = opts[Math.floor(Math.random() * opts.length)];
  sel.value = pick.value;
  sel.dispatchEvent(new Event('change'));
  onChange();
}

/** Read the current race-gender slug from the DOM selects (e.g., "human-male"). */
function getCurrentModelSlug(): string {
  const race = (document.getElementById('race-select') as HTMLSelectElement)?.value || 'human';
  const gender = (document.getElementById('gender-select') as HTMLSelectElement)?.value || 'male';
  return `${race}-${gender}`;
}

export function initEquipmentUI(onChange: () => void): void {
  const panel = document.getElementById('equipment-panel');
  if (!panel) return;

  fetch(assetUrl('/item-catalog.json'))
    .then(r => r.json())
    .then((data: ItemCatalog) => {
      catalog = data;
      buildPanel(panel, onChange);
    })
    .catch(err => {
      console.warn('Could not load item-catalog.json:', err);
      panel.innerHTML = '<span class="equip-title" style="opacity:0.5">No catalog</span>';
    });
}

function buildPanel(panel: HTMLElement, onChange: () => void) {
  if (!catalog) return;
  panel.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'equip-title';
  title.textContent = 'Equipment';
  panel.appendChild(title);

  // Weapon
  const { container: wCont, select: wSel } = buildFilteredSelect(
    'equip-weapon', catalog.weapons, weaponDisplayName,
    entry => { selection.weapon = entry; onChange(); },
  );
  panel.appendChild(makeRow('Weapon', wCont, wSel, 'weapon', onChange));

  // Offhand (combined weapons + shields)
  const offhandItems: OffhandEntry[] = [
    ...catalog.shields.map(s => ({ ...s, _type: 'shield' as const })),
    ...catalog.weapons.map(w => ({ ...w, _type: 'weapon' as const })),
  ];
  const { container: ohCont, select: ohSel } = buildFilteredSelect(
    'equip-offhand', offhandItems, offhandDisplayName,
    entry => { selection.offhand = entry; onChange(); },
  );
  panel.appendChild(makeRow('Offhand', ohCont, ohSel, 'offhand', onChange));

  // Head — filtered by current race-gender variants
  const helmetsForRace = () => catalog!.helmets.filter(h => h.variants.includes(getCurrentModelSlug()));
  let currentHelmets = helmetsForRace();
  const { container: hCont, select: hSel } = buildFilteredSelect(
    'equip-head', currentHelmets, itemDisplayName,
    entry => { selection.helmet = entry; onChange(); },
  );
  // Re-filter helmet list when race/gender changes
  const refreshHelmets = () => {
    currentHelmets = helmetsForRace();
    selection.helmet = undefined;
    hSel.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'None';
    noneOpt.style.color = '#888';
    hSel.appendChild(noneOpt);
    for (let i = 0; i < currentHelmets.length; i++) {
      const item = currentHelmets[i];
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = itemDisplayName(item);
      opt.style.color = QUALITY_COLOR[item.quality] || QUALITY_COLOR[1];
      hSel.appendChild(opt);
    }
    // Rebind change handler to use new array
    hSel.onchange = () => {
      if (hSel.value === '') {
        selection.helmet = undefined;
      } else {
        selection.helmet = currentHelmets[parseInt(hSel.value, 10)];
      }
      onChange();
    };
  };
  document.getElementById('race-select')?.addEventListener('change', refreshHelmets);
  document.getElementById('gender-select')?.addEventListener('change', refreshHelmets);
  panel.appendChild(makeRow('Head', hCont, hSel, 'head', onChange));

  // Shoulder
  const { container: sCont, select: sSel } = buildFilteredSelect(
    'equip-shoulder', catalog.shoulders, itemDisplayName,
    entry => { selection.shoulder = entry; onChange(); },
  );
  panel.appendChild(makeRow('Shoulder', sCont, sSel, 'shoulder', onChange));

  // Chest
  const { container: cCont, select: cSel } = buildFilteredSelect(
    'equip-chest', catalog.chest, itemDisplayName,
    entry => { selection.chest = entry; onChange(); },
  );
  panel.appendChild(makeRow('Chest', cCont, cSel, 'chest', onChange));

  // Legs
  const { container: lCont, select: lSel } = buildFilteredSelect(
    'equip-legs', catalog.legs, itemDisplayName,
    entry => { selection.legs = entry; onChange(); },
  );
  panel.appendChild(makeRow('Legs', lCont, lSel, 'legs', onChange));

  // Boots
  const { container: bCont, select: bSel } = buildFilteredSelect(
    'equip-boots', catalog.boots, itemDisplayName,
    entry => { selection.boots = entry; onChange(); },
  );
  panel.appendChild(makeRow('Boots', bCont, bSel, 'boots', onChange));

  // Gloves
  const { container: gCont, select: gSel } = buildFilteredSelect(
    'equip-gloves', catalog.gloves, itemDisplayName,
    entry => { selection.gloves = entry; onChange(); },
  );
  panel.appendChild(makeRow('Gloves', gCont, gSel, 'gloves', onChange));

  // Randomize All
  const randomAll = document.createElement('button');
  randomAll.id = 'equip-randomize-all';
  randomAll.textContent = 'Randomize All';
  randomAll.addEventListener('click', () => {
    for (const s of [wSel, ohSel, hSel, sSel, cSel, lSel, bSel, gSel]) {
      randomizeSlot(s, () => {});
    }
    onChange();
  });
  panel.appendChild(randomAll);
}

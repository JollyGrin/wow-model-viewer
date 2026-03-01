/**
 * Equipment UI — slot-based equipment picker with randomize support.
 *
 * Loads /item-catalog.json, builds per-slot selects, exposes state accessors.
 */

import type { BodyArmor } from './loadModel';

interface WeaponEntry  { slug: string; name: string; }
interface ChestEntry   { name: string; torsoUpperBase: string; armUpperBase?: string; torsoLowerBase?: string; }
interface LegsEntry    { name: string; legUpperBase: string; legLowerBase?: string; }
interface BootsEntry   { name: string; footBase: string; }
interface GlovesEntry  { name: string; handBase: string; armLowerBase?: string; }

interface ItemCatalog {
  weapons: WeaponEntry[];
  chest:   ChestEntry[];
  legs:    LegsEntry[];
  boots:   BootsEntry[];
  gloves:  GlovesEntry[];
}

let catalog: ItemCatalog | null = null;

// Active selections (undefined = None / no equipment)
const selection: {
  weapon?: string;      // weapon slug or undefined
  chest?: ChestEntry;
  legs?: LegsEntry;
  boots?: BootsEntry;
  gloves?: GlovesEntry;
} = {};

export function getWeaponPath(): string | undefined {
  if (!selection.weapon) return undefined;
  return `/items/weapon/${selection.weapon}`;
}

export function getArmorOptions(): BodyArmor | undefined {
  const armor: BodyArmor = {};
  if (selection.chest) {
    armor.armUpperBase   = selection.chest.armUpperBase;
    armor.torsoUpperBase = selection.chest.torsoUpperBase;
    armor.torsoLowerBase = selection.chest.torsoLowerBase;
  }
  if (selection.legs) {
    armor.legUpperBase = selection.legs.legUpperBase;
    armor.legLowerBase = selection.legs.legLowerBase;
  }
  if (selection.boots) {
    armor.footBase = selection.boots.footBase;
  }
  if (selection.gloves) {
    armor.handBase     = selection.gloves.handBase;
    armor.armLowerBase = selection.gloves.armLowerBase;
  }
  const hasAny = Object.values(armor).some(v => v);
  return hasAny ? armor : undefined;
}

function buildSelect<T extends { name: string }>(
  id: string,
  items: T[],
  onSelect: (entry: T | undefined) => void,
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.id = id;

  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'None';
  sel.appendChild(noneOpt);

  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.name;
    opt.textContent = item.name;
    sel.appendChild(opt);
  }

  sel.addEventListener('change', () => {
    const match = items.find(i => i.name === sel.value);
    onSelect(match);
  });

  return sel;
}

function buildWeaponSelect(items: WeaponEntry[], onSelect: (slug: string | undefined) => void): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.id = 'equip-weapon';

  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'None';
  sel.appendChild(noneOpt);

  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.slug;
    opt.textContent = item.name;
    sel.appendChild(opt);
  }

  sel.addEventListener('change', () => {
    onSelect(sel.value || undefined);
  });

  return sel;
}

function makeRow(label: string, select: HTMLSelectElement, diceSlot: string, onChange: () => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'equip-row';

  const lbl = document.createElement('span');
  lbl.className = 'equip-label';
  lbl.textContent = label;

  const btn = document.createElement('button');
  btn.className = 'equip-dice';
  btn.dataset.slot = diceSlot;
  btn.textContent = '🎲';
  btn.title = `Random ${label}`;
  btn.addEventListener('click', () => {
    randomizeSlot(diceSlot, onChange);
  });

  row.appendChild(lbl);
  row.appendChild(select);
  row.appendChild(btn);
  return row;
}

function randomizeSlot(slot: string, onChange: () => void) {
  if (!catalog) return;
  const selEl = document.getElementById(`equip-${slot}`) as HTMLSelectElement | null;
  if (!selEl) return;

  const opts = Array.from(selEl.options).filter(o => o.value !== '');
  if (opts.length === 0) return;

  const pick = opts[Math.floor(Math.random() * opts.length)];
  selEl.value = pick.value;
  selEl.dispatchEvent(new Event('change'));
  onChange();
}

export function initEquipmentUI(onChange: () => void): void {
  const panel = document.getElementById('equipment-panel');
  if (!panel) return;

  fetch('/item-catalog.json')
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
  title.textContent = '── Equipment ──';
  panel.appendChild(title);

  // Weapon row
  const weaponSel = buildWeaponSelect(catalog.weapons, slug => {
    selection.weapon = slug;
    onChange();
  });
  panel.appendChild(makeRow('Weapon', weaponSel, 'weapon', onChange));

  // Chest row
  const chestSel = buildSelect<ChestEntry>('equip-chest', catalog.chest, entry => {
    selection.chest = entry;
    onChange();
  });
  panel.appendChild(makeRow('Chest', chestSel, 'chest', onChange));

  // Legs row
  const legsSel = buildSelect<LegsEntry>('equip-legs', catalog.legs, entry => {
    selection.legs = entry;
    onChange();
  });
  panel.appendChild(makeRow('Legs', legsSel, 'legs', onChange));

  // Boots row
  const bootsSel = buildSelect<BootsEntry>('equip-boots', catalog.boots, entry => {
    selection.boots = entry;
    onChange();
  });
  panel.appendChild(makeRow('Boots', bootsSel, 'boots', onChange));

  // Gloves row
  const glovesSel = buildSelect<GlovesEntry>('equip-gloves', catalog.gloves, entry => {
    selection.gloves = entry;
    onChange();
  });
  panel.appendChild(makeRow('Gloves', glovesSel, 'gloves', onChange));

  // Randomize All button
  const randomAll = document.createElement('button');
  randomAll.id = 'equip-randomize-all';
  randomAll.textContent = 'Randomize All';
  randomAll.addEventListener('click', () => {
    for (const slot of ['weapon', 'chest', 'legs', 'boots', 'gloves']) {
      randomizeSlot(slot, () => {});
    }
    onChange();
  });
  panel.appendChild(randomAll);
}

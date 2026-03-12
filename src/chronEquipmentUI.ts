/**
 * Chronicle Equipment UI — item lookup via Chronicle API.
 *
 * Fetches item display data by ID from the Chronicle API,
 * maps to CDN asset paths, and exposes the same accessor interface
 * as equipmentUI.ts.
 */

import type { BodyArmor } from './loadModel';

// --- Quality colors (WoW standard) ---
const QUALITY_COLOR: Record<number, string> = {
  0: '#9d9d9d', // Poor
  1: '#ffffff', // Common
  2: '#1eff00', // Uncommon
  3: '#0070dd', // Rare
  4: '#a335ee', // Epic
  5: '#ff8000', // Legendary
  6: '#e268a8', // Artifact
};

// --- Inventory type → slot mapping ---

type SlotKey = 'weapon' | 'offhand' | 'head' | 'shoulder' | 'chest' | 'legs' | 'feet' | 'hands';

const SLOT_LABELS: Record<SlotKey, string> = {
  weapon: 'Weapon', offhand: 'Offhand', head: 'Head', shoulder: 'Shoulder',
  chest: 'Chest', legs: 'Legs', feet: 'Boots', hands: 'Gloves',
};

function invTypeToSlot(invType: number): SlotKey | null {
  switch (invType) {
    case 13: case 15: case 17: case 21: case 25: case 26: return 'weapon';
    case 14: case 22: case 23: return 'offhand';
    case 1: return 'head';
    case 3: return 'shoulder';
    case 5: case 20: return 'chest';
    case 7: return 'legs';
    case 8: return 'feet';
    case 10: return 'hands';
    default: return null;
  }
}

// --- Slugification (matches build pipeline: lowercase + _ → -) ---

function slugify(filename: string): string {
  return filename
    .replace(/\.\w+$/, '') // strip extension (.m2, .blp)
    .toLowerCase()
    .replace(/_/g, '-');
}

function stripShoulderPrefix(filename: string): string {
  return filename.replace(/^[LR]Shoulder_/i, '');
}

// --- Body texture region directories ---

const TEXTURE_REGION_DIRS = [
  'ArmUpperTexture',   // 0
  'ArmLowerTexture',   // 1
  'HandTexture',       // 2
  'TorsoUpperTexture', // 3
  'TorsoLowerTexture', // 4
  'LegUpperTexture',   // 5
  'LegLowerTexture',   // 6
  'FootTexture',       // 7
];

// --- Chronicle API response type ---

interface ChronicleItem {
  entry: number;
  name: string;
  quality: number;
  item_class: number;
  item_subclass: number;
  inventory_type: number;
  sheath: number;
  display_id: number;
  model_name: string[];
  model_texture: string[];
  geoset_group: number[];
  texture: string[];
  inventory_icon: string[];
  helmet_geoset_vis: number[];
  geoset_vis_id: number[];
  ground_model: string;
  item_visual: number;
  flags: number;
}

// --- Internal state ---

interface EquippedItem {
  item: ChronicleItem;
  slot: SlotKey;
}

const equipped: Partial<Record<SlotKey, EquippedItem>> = {};

// --- Exported accessors (same interface as equipmentUI.ts) ---

export function getWeaponPath(): string | undefined {
  const eq = equipped.weapon;
  if (!eq || !eq.item.model_name?.[0]) return undefined;
  const slug = slugify(eq.item.model_name[0]);
  return `/items/weapon/${slug}`;
}

export function getWeaponTexture(): string | undefined {
  const eq = equipped.weapon;
  if (!eq || !eq.item.model_texture?.[0]) return undefined;
  const modelSlug = slugify(eq.item.model_name[0]);
  const texSlug = slugify(eq.item.model_texture[0]);
  return `/items/weapon/${modelSlug}/textures/${texSlug}.tex`;
}

export function getOffhandPath(): string | undefined {
  const eq = equipped.offhand;
  if (!eq || !eq.item.model_name?.[0]) return undefined;
  const dir = eq.item.inventory_type === 14 ? 'shield' : 'weapon';
  const slug = slugify(eq.item.model_name[0]);
  return `/items/${dir}/${slug}`;
}

export function getOffhandTexture(): string | undefined {
  const eq = equipped.offhand;
  if (!eq || !eq.item.model_texture?.[0]) return undefined;
  const dir = eq.item.inventory_type === 14 ? 'shield' : 'weapon';
  const modelSlug = slugify(eq.item.model_name[0]);
  const texSlug = slugify(eq.item.model_texture[0]);
  return `/items/${dir}/${modelSlug}/textures/${texSlug}.tex`;
}

export function getArmorOptions(): BodyArmor | undefined {
  const armor: BodyArmor = {};

  // --- Helmet ---
  const head = equipped.head;
  if (head?.item.model_name?.[0]) {
    armor.helmet = slugify(head.item.model_name[0]);
    if (head.item.geoset_vis_id?.[0] || head.item.geoset_vis_id?.[1]) {
      armor.helmetGeosetVisID = [head.item.geoset_vis_id[0], head.item.geoset_vis_id[1]];
    }
    if (head.item.model_texture?.[0]) {
      armor.helmetTexture = slugify(head.item.model_texture[0]);
    }
  }

  // --- Shoulders ---
  const shoulder = equipped.shoulder;
  if (shoulder?.item.model_name?.[0]) {
    armor.shoulderSlug = slugify(stripShoulderPrefix(shoulder.item.model_name[0]));
    armor.shoulderHasRight = true; // assume both sides exist
    if (shoulder.item.model_texture?.[0]) {
      armor.shoulderTexture = slugify(shoulder.item.model_texture[0]);
    }
  }

  // --- Chest ---
  const chest = equipped.chest;
  if (chest) {
    const tex = chest.item.texture;
    const gg = chest.item.geoset_group;
    if (tex[0]) armor.armUpperBase = texBase(0, tex[0]);
    if (tex[3]) armor.torsoUpperBase = texBase(3, tex[3]);
    if (tex[4]) armor.torsoLowerBase = texBase(4, tex[4]);
    if (gg[0] > 0) armor.sleeveGeoset = gg[0] + 1;
    if (gg[2] > 0) armor.robeGeoset = gg[2] + 1;
    if (armor.robeGeoset) {
      if (tex[5]) armor.legUpperBase = texBase(5, tex[5]);
      if (tex[6]) armor.legLowerBase = texBase(6, tex[6]);
      if (tex[1]) armor.armLowerBase = texBase(1, tex[1]);
    }
  }

  // --- Legs ---
  const legs = equipped.legs;
  if (legs && !armor.robeGeoset) {
    const tex = legs.item.texture;
    const gg = legs.item.geoset_group;
    if (tex[5]) armor.legUpperBase = texBase(5, tex[5]);
    if (tex[6]) armor.legLowerBase = texBase(6, tex[6]);
    if (gg[2] > 0) armor.robeGeoset = gg[2] + 1;
  }

  const isDress = !!armor.robeGeoset;

  // --- Boots ---
  const boots = equipped.feet;
  if (boots) {
    const tex = boots.item.texture;
    const gg = boots.item.geoset_group;
    if (tex[7]) armor.footBase = texBase(7, tex[7]);
    if (gg[0] > 0) armor.footGeoset = gg[0] + 1;
    if (!isDress && tex[6]) armor.legLowerBase = texBase(6, tex[6]);
  }

  // --- Gloves ---
  const gloves = equipped.hands;
  if (gloves) {
    const tex = gloves.item.texture;
    const gg = gloves.item.geoset_group;
    if (tex[2]) armor.handBase = texBase(2, tex[2]);
    if (gg[0] > 0) armor.handGeoset = gg[0] + 1;
    if (tex[1]) armor.armLowerBase = texBase(1, tex[1]);
    if (!isDress && gg[1] > 0) armor.wristGeoset = gg[1] + 1;
  }

  const hasAny = Object.values(armor).some(v => v);
  return hasAny ? armor : undefined;
}

/** Build body texture base path from API texture name and region index. */
function texBase(regionIdx: number, texName: string): string {
  // Strip .blp extension if present
  const name = texName.replace(/\.blp$/i, '');
  return `/item-textures/${TEXTURE_REGION_DIRS[regionIdx]}/${name}`;
}

// --- API fetch ---

async function fetchItem(itemId: number): Promise<ChronicleItem> {
  const res = await fetch(`/chronicle-api/v1/internal/gamedata/display/item/${itemId}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

// --- UI ---

let onChangeCallback: (() => void) | null = null;
let statusEl: HTMLDivElement | null = null;
let slotsContainer: HTMLDivElement | null = null;

function setStatus(msg: string, color = '#e0d8c8') {
  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.style.color = color;
  }
}

function renderSlots() {
  if (!slotsContainer) return;
  slotsContainer.innerHTML = '';

  for (const key of Object.keys(SLOT_LABELS) as SlotKey[]) {
    const eq = equipped[key];
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:4px;';

    const label = document.createElement('span');
    label.className = 'equip-label';
    label.textContent = SLOT_LABELS[key];
    label.style.minWidth = '60px';

    const name = document.createElement('span');
    name.style.cssText = 'font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    if (eq) {
      name.textContent = eq.item.name;
      name.style.color = QUALITY_COLOR[eq.item.quality] || '#fff';
      name.title = `#${eq.item.entry} — ${eq.item.name}`;

      const btn = document.createElement('button');
      btn.className = 'equip-dice';
      btn.textContent = '\u2715';
      btn.title = 'Unequip';
      btn.style.fontSize = '10px';
      btn.addEventListener('click', () => {
        delete equipped[key];
        renderSlots();
        onChangeCallback?.();
      });
      row.appendChild(label);
      row.appendChild(name);
      row.appendChild(btn);
    } else {
      name.textContent = '—';
      name.style.color = '#555';
      row.appendChild(label);
      row.appendChild(name);
    }

    slotsContainer.appendChild(row);
  }
}

async function equipItem(itemId: number) {
  setStatus(`Loading #${itemId}...`, '#aaa');
  try {
    const item = await fetchItem(itemId);

    if (item.display_id === 0) {
      setStatus(`${item.name} — no display data`, '#ff6666');
      return;
    }

    const slot = invTypeToSlot(item.inventory_type);
    if (!slot) {
      setStatus(`${item.name} — not equippable (type ${item.inventory_type})`, '#ff6666');
      return;
    }

    // Check if it has any renderable content
    const hasModel = item.model_name?.some(n => n !== '');
    const hasTextures = item.texture?.some(t => t !== '');
    if (!hasModel && !hasTextures) {
      setStatus(`${item.name} — no model or textures`, '#ff6666');
      return;
    }

    equipped[slot] = { item, slot };
    setStatus(`${item.name} → ${SLOT_LABELS[slot]}`, QUALITY_COLOR[item.quality] || '#fff');
    renderSlots();
    onChangeCallback?.();
  } catch (err) {
    setStatus(`Error: ${(err as Error).message}`, '#ff6666');
  }
}

export function initChronEquipmentUI(onChange: () => void): void {
  onChangeCallback = onChange;
  const panel = document.getElementById('equipment-panel');
  if (!panel) return;

  panel.innerHTML = '';

  // Title
  const title = document.createElement('div');
  title.className = 'equip-title';
  title.textContent = 'Equipment (Chronicle)';
  panel.appendChild(title);

  // Item ID input row
  const inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;gap:4px;';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'equip-search';
  input.placeholder = 'Item ID (e.g. 19019)';
  input.style.flex = '1';

  const btn = document.createElement('button');
  btn.className = 'equip-dice';
  btn.textContent = 'Equip';
  btn.style.cssText = 'font-size:11px;padding:4px 8px;';

  const doEquip = () => {
    const id = parseInt(input.value.trim(), 10);
    if (isNaN(id) || id <= 0) {
      setStatus('Enter a valid item ID', '#ff6666');
      return;
    }
    equipItem(id);
    input.value = '';
  };

  btn.addEventListener('click', doEquip);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doEquip();
  });

  inputRow.appendChild(input);
  inputRow.appendChild(btn);
  panel.appendChild(inputRow);

  // Status
  statusEl = document.createElement('div');
  statusEl.style.cssText = 'font-size:10px;color:#777;min-height:14px;';
  panel.appendChild(statusEl);

  // Slot display
  slotsContainer = document.createElement('div');
  slotsContainer.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:4px;';
  panel.appendChild(slotsContainer);
  renderSlots();

  // Clear all
  const clearBtn = document.createElement('button');
  clearBtn.id = 'equip-randomize-all';
  clearBtn.textContent = 'Clear All';
  clearBtn.addEventListener('click', () => {
    for (const key of Object.keys(equipped) as SlotKey[]) {
      delete equipped[key];
    }
    renderSlots();
    setStatus('');
    onChange();
  });
  panel.appendChild(clearBtn);
}

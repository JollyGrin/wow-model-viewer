# Data Structure & Organization

## Overview

All item data is stored in `public/items.json` (~9.5MB, 10,951 items). Data is scraped from Turtle WoW database and processed through a multi-phase pipeline.

---

## Item Interface

```typescript
interface Item {
  // Core Identification
  itemId: number;              // Unique database ID
  name: string;                // Display name (e.g., "Thunderfury, Blessed Blade of the Windseeker")
  uniqueName: string;          // URL slug (e.g., "thunderfury-blessed-blade-of-the-windseeker")

  // Classification
  class: string;               // Item class (Weapon, Armor, Consumable, etc.)
  subclass: string;            // Item subclass (Sword, Plate, Potion, etc.)
  slot: string;                // Equipment slot (see Slot Types below)

  // Visual
  icon: string;                // Icon filename without extension (e.g., "inv_sword_19")
  quality: string;             // Rarity (Poor, Common, Uncommon, Rare, Epic, Legendary, Heirloom)

  // Requirements
  itemLevel: number;           // Item's power level (affects stats)
  requiredLevel: number;       // Minimum character level to equip

  // Tooltip Data
  tooltip: TooltipLine[];      // Array of tooltip lines with formatting

  // WoW Link Format
  itemLink: string;            // WoW hyperlink format: |cffa335ee|Hitem:647::::::::::0|h[Name]|h|r

  // Content Phase
  contentPhase: number;        // Classic WoW phase (1-6) when item becomes available

  // Acquisition
  sellPrice: number;           // Vendor sell price in copper
  source?: ItemSource;         // How to obtain the item
}
```

---

## Tooltip Structure

```typescript
interface TooltipLine {
  label: string;              // Text content of the line
  format?: string;            // Display formatting (optional)
}
```

### Format Values

| Format | Description | Example Use |
|--------|-------------|-------------|
| `alignRight` | Right-align text | Stats on right side |
| `indent` | Indent the line | Sub-stats, set bonuses |
| `Misc` | Miscellaneous styling | Flavor text |
| `q0` - `q7` | Quality color codes | Colored text |

### Tooltip Example

```json
{
  "tooltip": [
    { "label": "Thunderfury, Blessed Blade of the Windseeker" },
    { "label": "Binds when picked up" },
    { "label": "Main Hand", "format": "alignRight" },
    { "label": "Sword" },
    { "label": "36 - 68 Damage", "format": "alignRight" },
    { "label": "Speed 1.90" },
    { "label": "+5 Agility", "format": "indent" },
    { "label": "+8 Stamina", "format": "indent" },
    { "label": "Chance on hit: Blasts your enemy with lightning..." }
  ]
}
```

---

## Item Source

```typescript
interface ItemSource {
  category: string;           // Source type
  dropChance?: number;        // Drop rate percentage (for drops)
  quests?: Quest[];           // Quest info (for quest rewards)
  zone?: number;              // Zone ID (for zone drops)
}

interface Quest {
  id: number;                 // Quest ID
  name: string;               // Quest name
  minLevel?: number;          // Minimum level to accept quest
}
```

### Source Categories

| Category | Description |
|----------|-------------|
| `Boss Drop` | Drops from dungeon/raid bosses |
| `Quest` | Quest reward |
| `Rare Drop` | Low chance world drop |
| `Vendor` | Purchased from NPC |
| `Zone Drop` | Drops from mobs in specific zone |
| `Crafted` | Created via profession |

---

## Equipment Slots

### Armor Slots
- `Head`
- `Shoulder`
- `Chest`
- `Waist`
- `Legs`
- `Feet`
- `Wrist`
- `Hands`
- `Back`
- `Shirt`
- `Tabard`

### Weapon Slots
- `Main Hand`
- `Off Hand`
- `One-Hand`
- `Two-Hand`

### Accessory Slots
- `Neck`
- `Finger`
- `Trinket`

### Ranged Slots
- `Ranged`
- `Thrown`
- `Ammo`
- `Relic`

### Special
- `Held In Off-hand` (Caster off-hands, books, etc.)

---

## Quality Tiers

| Quality | Color Hex | Color Name |
|---------|-----------|------------|
| Poor | `#9d9d9d` | Gray |
| Common | `#ffffff` | White |
| Uncommon | `#1eff00` | Green |
| Rare | `#0070dd` | Blue |
| Epic | `#a335ee` | Purple |
| Legendary | `#ff8000` | Orange |
| Heirloom | `#00ccff` | Cyan |

---

## Item Classes & Subclasses

### Weapons (class: "Weapon")

| Subclass | Category Code |
|----------|---------------|
| One-Handed Axes | 2.0 |
| Two-Handed Axes | 2.1 |
| Bows | 2.2 |
| Guns | 2.3 |
| One-Handed Maces | 2.4 |
| Two-Handed Maces | 2.5 |
| Polearms | 2.6 |
| One-Handed Swords | 2.7 |
| Two-Handed Swords | 2.8 |
| Staves | 2.10 |
| Fist Weapons | 2.13 |
| Miscellaneous | 2.14 |
| Daggers | 2.15 |
| Thrown | 2.16 |
| Spears | 2.17 |
| Crossbows | 2.18 |
| Wands | 2.19 |
| Fishing Poles | 2.20 |

### Armor (class: "Armor")

| Subclass | Category Pattern |
|----------|------------------|
| Amulets | 4.0.2 |
| Rings | 4.0.11 |
| Trinkets | 4.0.12 |
| Cloaks | 4.1.16 |
| Shields | 4.6.14 |
| Cloth (by slot) | 4.1.1 - 4.1.10 |
| Leather (by slot) | 4.2.1 - 4.2.10 |
| Mail (by slot) | 4.3.1 - 4.3.10 |
| Plate (by slot) | 4.4.1 - 4.4.10 |

### Armor Slot Codes (within type)
```
.1 = Head
.3 = Shoulder
.5 = Chest
.6 = Waist
.7 = Legs
.8 = Feet
.9 = Wrist
.10 = Hands
```

---

## Data Files Structure

### Production Data
```
public/
└── items.json              # Final merged item data (10,951 items)
```

### Scraping Artifacts
```
turtle_db/
├── extraction-summary.json         # Summary of last extraction run
├── failed-items.json               # Items that failed to scrape
├── failed-quest-ids.json           # Quest IDs that failed
├── id-extraction-progress.json     # ID extraction progress
├── items-2.0.json                  # One-handed axes
├── items-2.1.json                  # Two-handed axes
├── ...                             # Category-specific files
├── items-4.4.10.json               # Plate hands
└── items/                          # Individual item files (optional)
```

---

## Icon URL Construction

```typescript
function getIconUrl(icon: string, size: 'small' | 'medium' | 'large'): string {
  // Size mappings: small=18px, medium=36px, large=56px
  return `https://wow.zamimg.com/images/wow/icons/${size}/${icon}.jpg`;
}

// Example
const icon = "inv_sword_19";
const url = getIconUrl(icon, "medium");
// Result: https://wow.zamimg.com/images/wow/icons/medium/inv_sword_19.jpg
```

---

## ItemLink Format

WoW item links follow a specific format for in-game linking:

```
|cff{color}|Hitem:{itemId}:{enchantId}:{gem1}:{gem2}:{gem3}:{gem4}:{suffixId}:{uniqueId}:{linkLevel}:{specializationId}:{upgradeTypeId}:{instanceDifficultyId}:{numBonusIds}:{bonusId1}:{bonusId2}:...|h[{itemName}]|h|r
```

### Classic Format (simplified)
```
|cffa335ee|Hitem:647::::::::::0|h[Destiny]|h|r
```

Components:
- `|cff{color}` - Text color (a335ee = Epic purple)
- `|Hitem:{itemId}` - Hyperlink with item ID
- `|h[{name}]|h` - Display name
- `|r` - Reset formatting

---

## Data Validation Rules

When processing items, validate:

1. **Required Fields**: `itemId`, `name`, `icon`, `class`, `slot`
2. **Numeric Fields**: `itemLevel >= 0`, `requiredLevel >= 0`, `sellPrice >= 0`
3. **Quality**: Must be one of the valid quality strings
4. **Tooltip**: Must be array (can be empty)
5. **UniqueName**: Must be lowercase, hyphenated, URL-safe

---

## Example Item

```json
{
  "itemId": 19019,
  "name": "Thunderfury, Blessed Blade of the Windseeker",
  "uniqueName": "thunderfury-blessed-blade-of-the-windseeker",
  "icon": "inv_sword_39",
  "class": "Weapon",
  "subclass": "Sword",
  "slot": "Main Hand",
  "quality": "Legendary",
  "itemLevel": 80,
  "requiredLevel": 60,
  "sellPrice": 250738,
  "contentPhase": 3,
  "itemLink": "|cffff8000|Hitem:19019::::::::::0|h[Thunderfury, Blessed Blade of the Windseeker]|h|r",
  "tooltip": [
    { "label": "Thunderfury, Blessed Blade of the Windseeker" },
    { "label": "Binds when picked up" },
    { "label": "Unique" },
    { "label": "Main Hand", "format": "alignRight" },
    { "label": "Sword" },
    { "label": "36 - 68 Damage", "format": "alignRight" },
    { "label": "Speed 1.90" },
    { "label": "(27.4 damage per second)" },
    { "label": "+5 Agility" },
    { "label": "+8 Stamina" },
    { "label": "+8 Fire Resistance" },
    { "label": "+9 Nature Resistance" },
    { "label": "Chance on hit: Blasts your enemy with lightning, dealing 300 Nature damage and then jumping to additional nearby enemies." }
  ],
  "source": {
    "category": "Boss Drop",
    "dropChance": 4
  }
}
```

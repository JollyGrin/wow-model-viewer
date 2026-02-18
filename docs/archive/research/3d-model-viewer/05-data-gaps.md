# Data Gaps: What We Have vs What We Need

## Current Item Data Structure

**File**: `public/data/items.json` (~10,951 items)

Each item has these fields:
| Field | Type | Example | Have? |
|-------|------|---------|-------|
| itemId | number | 647 | Yes |
| name | string | "Destiny" | Yes |
| icon | string | "inv_sword_19" | Yes |
| class | string | "Weapon" / "Armor" | Yes |
| subclass | string | "Sword" / "Leather" | Yes |
| slot | string | "Two-Hand" / "Head" | Yes |
| quality | string | "Epic" / "Rare" | Yes |
| itemLevel | number | 57 | Yes |
| requiredLevel | number | 52 | Yes |
| sellPrice | number | 70024 | Yes |
| tooltip | array | [{label, format}] | Yes |
| itemLink | string | WoW hyperlink format | Yes |
| contentPhase | number | 1 | Yes |
| source | object/null | {category, name, zone} | Yes |
| uniqueName | string | URL-friendly slug | Yes |
| createdBy | array | (742 items, crafting info) | Partial |

## What's Missing for 3D Model Viewer

### Critical: `displayId` -- PRIMARY BLOCKER

**0 items** have a `displayId` field under any naming convention.

This is what every model viewer needs to resolve an item's visual appearance. The mapping chain is:
```
itemId -> displayId -> model files + textures
```

Without `displayId`, we cannot:
- Render 3D models
- Show static item renders
- Use any model viewer library

### Important: Equipment Slot Mapping

Our `slot` field uses UI-friendly names. The model viewer needs numeric slot IDs:

| Our Slot Name | Viewer Slot ID |
|---------------|----------------|
| Head | 1 |
| Neck | 2 |
| Shoulder | 3 |
| Chest | 5 |
| Waist | 6 |
| Legs | 7 |
| Feet | 8 |
| Wrists | 9 |
| Hands | 10 |
| Finger | 11 |
| Trinket | 13 |
| Back | 15 |
| Main Hand | 16 |
| Off Hand | 17 |
| Ranged | 18 |
| Tabard | 19 |
| One-Hand | 16 or 17 (context) |
| Two-Hand | 16 |

This mapping already exists in our codebase (`SLOT_MAP` in the deprecated viewer docs). Minor adaptation needed.

### Nice-to-Have: `stats` Field

The TypeScript `Item` interface declares `stats: ItemStats` but **no items have stats data** in the JSON. Not needed for 3D rendering but would enhance the scrubber view.

## How to Get Display IDs

### Option 1: Turtle-WOW-DBC Repository (Best)
- **Source**: https://github.com/oplancelot/Turtle-WOW-DBC
- Contains `ItemDisplayInfo.dbc` AND presumably `Item.dbc` with the itemId -> displayId mapping
- Covers both vanilla AND Turtle WoW custom items
- **Action**: Download the repo, extract the Item.dbc JSON, build a lookup map

### Option 2: Add to Scraping Pipeline
- During our data scraping (see `docs/inspiration/06-data-scraping.md`), add displayId extraction
- Wowhead item pages contain displayId in their JavaScript data
- Could scrape from `https://www.wowhead.com/classic/item={itemId}` page source
- **Limitation**: Only works for vanilla items on Wowhead, not Turtle WoW custom items

### Option 3: wow-classic-items npm Package
- **Source**: https://github.com/nexus-devs/wow-classic-items
- Pre-scraped Wowhead data as JSON
- May contain displayId fields
- **Limitation**: Only vanilla items

### Option 4: Runtime API Lookup
- Query a service at runtime to resolve itemId -> displayId
- Could use `wotlk.murlocvillage.com/api/items` (used by wow-model-viewer)
- **Limitation**: Adds latency, dependency on external service, may not cover Turtle WoW items

### Recommended Approach
1. Download Turtle-WOW-DBC repo
2. Extract Item.dbc -> build `{itemId: displayId}` lookup table
3. Add `displayId` field to our `items.json` during the data pipeline
4. Store as a separate lookup file if adding to items.json bloats it too much

## Item ID Analysis

| Range | Count | Wowhead Model Data? |
|-------|-------|---------------------|
| < 30,000 (vanilla) | ~8,639 | Yes -- full support |
| 30,000 - 40,000 (TBC-era) | ~796 | Likely yes |
| 40,000+ (Turtle custom) | ~588 | No -- custom models |
| 50,000+ | ~10 | No -- custom models |

Total items: 10,951
Items with vanilla model support: ~9,400 (86%)
Items needing fallback: ~1,550 (14%)

## Existing Infrastructure We Can Reuse

From the deprecated model viewer (`docs/inspiration/05-3d-model-viewer.md`):

| Component | Status | Reusable? |
|-----------|--------|-----------|
| Slot mapping (SLOT_MAP) | Documented | Yes -- copy directly |
| Race IDs (RACE_IDS) | Documented | Yes -- copy directly |
| Component interface | Documented | Yes -- adapt |
| Wowhead proxy route | Documented (not implemented) | Yes -- implement |
| Display ID API route | Documented (not implemented) | Maybe -- if runtime lookup needed |
| Level scrubber integration | Documented | Yes -- we have level scrubber already |

## TypeScript Types Needed

```typescript
// New fields
interface ItemWithDisplay extends Item {
  displayId?: number;  // From ItemDisplayInfo lookup
}

// Viewer slot mapping
const SLOT_MAP: Record<string, number> = {
  'Head': 1,
  'Shoulder': 3,
  'Chest': 5,
  'Waist': 6,
  'Legs': 7,
  'Feet': 8,
  'Wrists': 9,
  'Hands': 10,
  'Back': 15,
  'Main Hand': 16,
  'Off Hand': 17,
  'One-Hand': 16,  // or 17 depending on context
  'Two-Hand': 16,
  'Ranged': 18,
  'Tabard': 19,
};

// Race IDs for viewer
const RACE_IDS: Record<string, number> = {
  human: 1, orc: 2, dwarf: 3, nightelf: 4,
  undead: 5, tauren: 6, gnome: 7, troll: 8,
  // Turtle WoW custom:
  highelf: 10,  // Uses Blood Elf ID
  goblin: 9,    // Custom
};
```

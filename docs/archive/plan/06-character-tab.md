# Phase 6: Character Tab

## Overview

WoW-style paperdoll screen with gear slots arranged around a 3D character model. Level scrubber controls which gear is shown. Reuses existing `computeEquippedAtLevel()` and `LevelScrubber`.

## Goals

1. New "Character" tab in nav
2. Paperdoll layout with icon slots matching WoW character screen
3. 3D model viewer showing equipped gear on a character
4. Level scrubber to visualize gear progression over time

## Order of Work

Start with the 3D model and UI first. Data pipeline (displayId lookup) comes last — we want to prove the model viewer works before building tooling around it.

### Step 1: Paperdoll Layout — Static UI with Icons

Gear slots arranged around a center placeholder. No 3D model yet.

### Step 2: 3D Model Viewer

Replace the center placeholder with `wow-model-viewer`. CORS proxy route, dynamic import, slot mapping.

### Step 3: Data Pipeline — displayId Lookup

Build script to extract `(itemId, displayId)` pairs from `data/external/item_template.sql`. Wire into model viewer so equipped items render on the 3D model.

### Step 4: Level Scrubber Integration

Wire scrubber changes to both icon slots and 3D model. Debounce if model re-init is expensive.

## Components

### CharacterTab (`app/components/character/character-tab.tsx`)

Orchestrator. Takes BiS items, manages `selectedLevel` state. Computes `equippedMap` via `computeEquippedAtLevel()`. Passes items to paperdoll and model.

### PaperdollLayout (`app/components/character/paperdoll-layout.tsx`)

WoW-style gear arrangement — three columns:

```
  [Head]                    [Hands]
  [Neck]                    [Waist]
  [Shoulder]                [Legs]
  [Back]          MODEL     [Feet]
  [Chest]                   [Finger]
  [Wrist]                   [Finger]
                            [Trinket]
                            [Trinket]
       [MH]    [OH]    [Ranged]
```

Left column: Head, Neck, Shoulder, Back, Chest, Wrist
Center: Model viewer (or silhouette placeholder)
Right column: Hands, Waist, Legs, Feet, Finger x2, Trinket x2
Bottom center: Main Hand, Off Hand, Ranged

### GearSlot (`app/components/character/gear-slot.tsx`)

Single slot component. Shows item icon (zamimg URL) with quality border when equipped, or an empty slot frame when not.

### ModelViewer (`app/components/character/model-viewer.tsx`)

Client component wrapping `wow-model-viewer`. Dynamic import (needs `window`). Props: `race`, `gender`, `items` as `[slotId, displayId][]`. Sets `window.CONTENT_PATH` to CORS proxy. Default: Human Male.

## Technical Approach

### Reuse from Progression Tab

- `computeEquippedAtLevel()` — best items at a given level
- `LevelScrubber` — level range input with tick marks
- Zamimg icon URL: `https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg`
- `normalizeSlot()` — raw slot → equipment slot
- `SLOT_GROUP_ORDER` — paperdoll ordering

### CORS Proxy

Route: `app/api/wowhead-proxy/[...path]/route.ts`
Proxies `https://wow.zamimg.com/modelviewer/classic/...` with cache headers.

### Viewer Slot Mapping

Map our `EquipmentSlot` names to wow-model-viewer numeric IDs:

```
Head→1, Shoulder→3, Chest→5, Waist→6, Legs→7, Feet→8,
Wrist→9, Hands→10, Back→15, Main Hand→16, Off Hand→17, Ranged→18
```

Non-visible slots (Neck, Finger, Trinket) excluded — they don't render on models.

### Display ID Lookup

Script: `scripts/build-display-ids.ts`
Input: `data/external/item_template.sql` (INSERT statements)
Output: `public/data/display-ids.json` as `{ [itemId: string]: number }`

Runtime: `app/lib/display-ids.ts` — fetch + cache the JSON, export `getDisplayId(itemId): number | null`

## File Structure

```
app/components/character/
├── character-tab.tsx
├── paperdoll-layout.tsx
├── gear-slot.tsx
├── model-viewer.tsx
└── index.ts

app/api/wowhead-proxy/[...path]/
└── route.ts

app/lib/
├── display-ids.ts
└── viewer-constants.ts

scripts/
└── build-display-ids.ts
```

## Verification

- [ ] Character tab navigable from nav bar
- [ ] All 17 gear slots render (Head through Ranged, with 2x Finger and 2x Trinket)
- [ ] Equipped items show icon with quality border
- [ ] Empty slots show placeholder frame
- [ ] 3D model loads in center
- [ ] Equipped items render on 3D model
- [ ] Level scrubber changes gear in slots and on model
- [ ] Unit tests pass
- [ ] E2E tests pass
- [ ] Existing tests unaffected

# Phase 1: Data Layer

## Overview

Create TypeScript types, slot normalization utilities, and an items service for loading and querying the 10,951 items in `public/items.json`.

## Goals

1. TypeScript interface for Item with strict typing
2. Slot normalization utility (One-Hand → Main Hand/Off Hand, Two-Hand → both)
3. Items service singleton for data access
4. Unit tests for all utilities

## Data Structure (from items.json)

### Item Fields

```typescript
{
  itemId: number
  name: string
  icon: string
  class: "Armor" | "Weapon" | "Miscellaneous" | "Projectile" | "Quest" | "Trade Goods"
  subclass: string
  sellPrice: number
  quality: "Uncommon" | "Rare" | "Epic" | "Legendary" | "Heirloom"
  itemLevel: number
  requiredLevel: number
  slot: string // See slot values below
  tooltip: TooltipLine[]
  itemLink: string
  contentPhase: number
  source: { category: string, dropChance?: number } | null
  uniqueName: string
}
```

### Slot Values

Raw slots from data:
- Ammo, Back, Chest, Feet, Finger, Hands, Head, Legs, Neck, Shoulder, Shirt, Tabard, Trinket, Waist, Wrist
- Main Hand, Off Hand, Held In Off-hand
- One-Hand (needs normalization)
- Two-Hand (needs normalization)
- Ranged, Thrown, Relic

### Normalized Slots (for UI)

Equipment slots for the character panel:
- Head, Neck, Shoulder, Back, Chest, Shirt, Tabard, Wrist
- Hands, Waist, Legs, Feet
- Finger (×2), Trinket (×2)
- Main Hand, Off Hand
- Ranged/Relic

## Implementation

### 1. Types (`app/lib/types.ts`)

- `Item` interface matching JSON structure
- `ItemQuality` type union
- `ItemClass` type union
- `EquipmentSlot` type for normalized slots
- `TooltipLine` interface

### 2. Slot Utilities (`app/lib/slots.ts`)

- `normalizeSlot(rawSlot: string, position?: 'main' | 'off')`: Convert raw slot to equipment slot
- `getEquippableSlots(item: Item)`: Returns array of slots an item can go in
- `EQUIPMENT_SLOTS`: Ordered list of all equipment slots

### 3. Items Service (`app/lib/items-service.ts`)

Singleton service with:
- `loadItems()`: Fetch and cache items from JSON
- `getItems()`: Return all cached items
- `getItemById(id: number)`: Find single item
- `searchItems(query: string)`: Text search on name
- `filterItems(filters: ItemFilters)`: Filter by slot, class, quality, etc.

## File Structure

```
app/lib/
├── types.ts           # TypeScript interfaces
├── slots.ts           # Slot normalization
├── items-service.ts   # Data loading and querying
└── utils.ts           # Existing (cn utility)

tests/unit/
├── utils.test.ts      # Existing
├── types.test.ts      # Type guards/validation
├── slots.test.ts      # Slot normalization tests
└── items-service.test.ts  # Service tests
```

## Verification

- [ ] `bun test` passes all unit tests
- [ ] Items load successfully from JSON
- [ ] Slot normalization handles all edge cases
- [ ] Type checking catches invalid data

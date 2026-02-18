# BiS Timeline & Level Scrubber

## Overview

The BiS Timeline is the primary UI component that visualizes gear progression from level 1-60. Each equipment slot has a horizontal bar showing when items become available based on their `requiredLevel`.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/components/EquipmentSlot.tsx` | Timeline bars and scrubber |
| `app/page.tsx` | Main page orchestrating components |

---

## Timeline Visualization

### Visual Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ HEAD                                                            │
│ ├── Level Markers: 1    10    20    30    40    50    60       │
│ ├── ─────[Icon1]────────[Icon2]─────────[Icon3]─────────────   │
│ └── Horizontal bar with items positioned by requiredLevel      │
└─────────────────────────────────────────────────────────────────┘
```

### Position Calculation

```typescript
// Calculate item position on the 1-60 timeline
function calculatePosition(requiredLevel: number): number {
  // Level 1 = 0%, Level 60 = 100%
  return ((requiredLevel - 1) / 59) * 100;
}

// Examples:
// Level 1  → 0%
// Level 10 → 15.25%
// Level 30 → 49.15%
// Level 60 → 100%
```

### Level Markers

Fixed markers at specific level breakpoints:

```typescript
const LEVEL_MARKERS = [1, 10, 20, 30, 40, 50, 60];
```

---

## Component Structure

### EquipmentSlotList

Parent component that groups items by slot and renders individual slot bars.

```typescript
interface EquipmentSlotListProps {
  items: Item[];                    // All items in the BiS list
  onRemoveItem?: (item: Item) => void;
  currentLevel?: number;            // Level for scrubber filtering
  showScrubber?: boolean;           // Show/hide scrubber
}
```

**Logic Flow:**
1. Group items by `item.slot`
2. Sort items within each group by `requiredLevel`
3. Render EquipmentSlot for each slot with items

### EquipmentSlot

Individual slot bar with items and optional interactions.

```typescript
interface EquipmentSlotProps {
  slot: string;                     // Slot name (e.g., "Head")
  items: Item[];                    // Items for this slot
  onRemoveItem?: (item: Item) => void;
  currentLevel?: number;
  showBestItem?: boolean;           // Highlight best item for level
}
```

---

## Item Display

### Quality-Based Borders

Items display with colored borders based on quality:

```css
.item-epic    { border-color: #a335ee; }  /* Purple */
.item-rare    { border-color: #0070dd; }  /* Blue */
.item-uncommon { border-color: #1eff00; } /* Green */
.item-common  { border-color: #ffffff; }  /* White */
.item-poor    { border-color: #9d9d9d; }  /* Gray */
```

### Icon Construction

```typescript
function getItemIconUrl(icon: string, size: 'small' | 'medium' | 'large' = 'medium'): string {
  return `https://wow.zamimg.com/images/wow/icons/${size}/${icon}.jpg`;
}
```

### Item Tooltip

On hover, items show:
- Item name
- Required level
- Quality
- Source (if available)

Uses Wowhead tooltip integration for detailed stats.

---

## Level Scrubber

### Purpose

Interactive slider to view "best item per slot" at any level between 1-60.

### Visual Design

```
┌─────────────────────────────────────────────────────────────────┐
│ [1]━━━━━━━━━━━━━━━━━━━[◆ Lv.30]━━━━━━━━━━━━━━━━━━━━━━━━━━[60]  │
└─────────────────────────────────────────────────────────────────┘
     Draggable scrubber handle showing current level
```

### Scrubber Component

```typescript
interface ScrubberProps {
  currentLevel: number;
  onLevelChange: (level: number) => void;
  minLevel?: number;      // Default: 1
  maxLevel?: number;      // Default: 60
}
```

### Interaction Logic

```typescript
function handleMouseMove(e: MouseEvent, containerRect: DOMRect) {
  // Calculate percentage position on bar
  const percentage = (e.clientX - containerRect.left) / containerRect.width;

  // Clamp to valid range
  const clampedPercentage = Math.max(0, Math.min(1, percentage));

  // Convert to level (1-60)
  const level = Math.round(clampedPercentage * 59) + 1;

  onLevelChange(level);
}
```

### Keyboard Shortcuts

```typescript
// Toggle scrubber visibility
useHotkeys('mod+j', () => {
  setShowScrubber(prev => !prev);
});
```

---

## Best Item Calculation

### Logic

For each slot at a given level, find the "best" equippable item:

```typescript
function calculateBestItems(
  items: Item[],
  currentLevel: number
): Record<string, Item> {
  const bestItems: Record<string, Item> = {};

  // Group by slot
  const itemsBySlot = groupBy(items, 'slot');

  for (const [slot, slotItems] of Object.entries(itemsBySlot)) {
    // Filter to equippable items (requiredLevel <= currentLevel)
    const equippable = slotItems.filter(
      item => item.requiredLevel <= currentLevel
    );

    if (equippable.length === 0) continue;

    // Best = highest itemLevel among equippable
    // Or highest requiredLevel if itemLevel is equal
    const best = equippable.reduce((a, b) => {
      if (a.itemLevel !== b.itemLevel) {
        return a.itemLevel > b.itemLevel ? a : b;
      }
      return a.requiredLevel > b.requiredLevel ? a : b;
    });

    bestItems[slot] = best;
  }

  return bestItems;
}
```

### Visual Highlight

When scrubber is active:
- Best item for current level is highlighted
- Non-best items are dimmed
- Clear visual distinction between "current best" and "future upgrades"

---

## State Management

### Page-Level State

```typescript
// In app/page.tsx
const [showScrubber, setShowScrubber] = useState(false);
const [currentLevel, setCurrentLevel] = useState(30);  // Default midpoint
const [bestItems, setBestItems] = useState<Record<string, Item>>({});

// Recalculate best items when level or items change
useEffect(() => {
  if (showScrubber && selectedItems.length > 0) {
    const best = calculateBestItems(selectedItems, currentLevel);
    setBestItems(best);
  }
}, [currentLevel, selectedItems, showScrubber]);
```

---

## Slot Ordering

Slots are rendered in a logical grouping order:

```typescript
const SLOT_ORDER = [
  // Armor
  'Head',
  'Shoulder',
  'Chest',
  'Waist',
  'Legs',
  'Feet',
  'Wrist',
  'Hands',
  'Back',

  // Accessories
  'Neck',
  'Finger',
  'Trinket',

  // Weapons
  'Main Hand',
  'Off Hand',
  'Two-Hand',
  'One-Hand',
  'Ranged',

  // Special
  'Held In Off-hand',
];
```

---

## Responsive Design

### Mobile Considerations

- Timeline bars stack vertically
- Icons resize based on viewport
- Touch-friendly scrubber interaction
- Horizontal scroll for small screens

### CSS Classes

```css
.equipment-slot-container {
  @apply flex flex-col gap-4;
}

.timeline-bar {
  @apply relative h-12 bg-wow-medium-blue rounded;
}

.item-icon {
  @apply absolute w-8 h-8 rounded border-2 cursor-pointer;
  @apply hover:scale-110 transition-transform;
}

.scrubber-handle {
  @apply absolute w-1 h-full bg-wow-gold cursor-ew-resize;
}
```

---

## Integration Points

### With ItemSearchModal

When user adds item from search:
1. Item added to `selectedItems` state
2. EquipmentSlotList re-renders with new item
3. Item appears on correct slot's timeline

### With BisListManager

- Timeline displays items from active BiS list
- Auto-saves trigger when items change
- Loading a list updates timeline

### With 3D Model Viewer

When scrubber is active:
1. `bestItems` calculated for current level
2. Passed to WowModelViewer component
3. Character model updates to show best gear

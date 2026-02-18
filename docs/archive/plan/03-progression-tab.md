# Phase 3: Progression Tab

## Overview

Build the progression timeline that visualizes BiS items by level. Users can see their gear progression from level 1-60 and manage items in their list.

## Goals

1. Timeline component showing levels 1-60
2. Items positioned by required level
3. Stacking logic for multiple items at same level
4. Remove item from list
5. E2E tests

## Components

### ProgressionTab (`app/components/progression/progression-tab.tsx`)

Main container with:
- Timeline visualization
- Summary stats (total items, coverage)
- Clear all button

### Timeline (`app/components/progression/timeline.tsx`)

Horizontal scrollable timeline:
- Level markers (1-60)
- Items positioned at their required level
- Hover/click for item details

### TimelineItem (`app/components/progression/timeline-item.tsx`)

Single item on timeline:
- Icon with quality border
- Tooltip on hover
- Click to remove

## Technical Approach

### Level Grouping

Group items by required level for efficient rendering:
```typescript
const itemsByLevel = useMemo(() => {
  const grouped: Record<number, Item[]> = {}
  for (const item of items) {
    const level = item.requiredLevel
    if (!grouped[level]) grouped[level] = []
    grouped[level].push(item)
  }
  return grouped
}, [items])
```

### Stacking

When multiple items at same level:
- Stack vertically with slight offset
- Group by slot to avoid visual clutter
- Maximum 5 visible, then "+N more"

### Timeline Layout

```
Level: 1     10    20    30    40    50    60
       |-----|-----|-----|-----|-----|-----|
              [Item]    [Item][Item]  [Item]
                           [Item]
```

### Quality Border Colors

```typescript
const QUALITY_BORDERS = {
  Uncommon: 'border-green-500',
  Rare: 'border-blue-500',
  Epic: 'border-purple-500',
  Legendary: 'border-orange-500',
  Heirloom: 'border-amber-400',
}
```

## File Structure

```
app/components/progression/
├── progression-tab.tsx
├── timeline.tsx
├── timeline-item.tsx
└── index.ts
```

## Verification

- [ ] Timeline renders level markers
- [ ] Items appear at correct levels
- [ ] Items stack when at same level
- [ ] Can remove items from timeline
- [ ] E2E tests pass

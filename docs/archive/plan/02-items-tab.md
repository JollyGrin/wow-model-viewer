# Phase 2: Items Tab

## Overview

Build the main items browsing interface with search, filters, sorting, and infinite scroll. Users can add items to their BiS list from this tab.

## Goals

1. Search items by name
2. Filter by slot, class, quality, level, phase
3. Sort by name, level, item level, quality
4. Infinite scroll for 10,951 items
5. Add to BiS list button (stores locally)
6. E2E tests

## Components

### ItemsTab (`app/components/items/items-tab.tsx`)

Main container with:
- Search input
- Filter dropdowns
- Sort controls
- Item list

### ItemFilters (`app/components/items/item-filters.tsx`)

Filter controls:
- Slot dropdown (normalized slots)
- Class dropdown
- Quality dropdown
- Level range inputs
- Phase dropdown

### ItemList (`app/components/items/item-list.tsx`)

Virtualized/infinite scroll list:
- Uses intersection observer for infinite loading
- Renders ItemCard for each item
- Handles empty state

### ItemCard (`app/components/items/item-card.tsx`)

Single item display:
- Icon (using WoW icon CDN)
- Name (colored by quality)
- Slot, level, item level
- Source info
- Add to list button

## Technical Approach

### Infinite Scroll

Use IntersectionObserver to load items in batches of 50:
```typescript
const BATCH_SIZE = 50
const [displayCount, setDisplayCount] = useState(BATCH_SIZE)

// When sentinel is visible, load more
useEffect(() => {
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      setDisplayCount(prev => Math.min(prev + BATCH_SIZE, filteredItems.length))
    }
  })
  observer.observe(sentinelRef.current)
  return () => observer.disconnect()
}, [filteredItems.length])
```

### Search Debouncing

Debounce search input by 200ms to avoid excessive filtering.

### Quality Colors

```typescript
const QUALITY_COLORS = {
  Uncommon: 'text-green-500',
  Rare: 'text-blue-500',
  Epic: 'text-purple-500',
  Legendary: 'text-orange-500',
  Heirloom: 'text-yellow-500',
}
```

### Icon CDN

WoW icons from: `https://wow.zamimg.com/images/wow/icons/large/{icon}.jpg`

## File Structure

```
app/components/items/
├── items-tab.tsx
├── item-filters.tsx
├── item-list.tsx
├── item-card.tsx
└── index.ts

app/hooks/
├── use-items.ts       # React Query hook for items
└── use-debounce.ts    # Debounce hook
```

## Verification

- [ ] Search filters items by name
- [ ] All filter dropdowns work
- [ ] Sorting works in both directions
- [ ] Infinite scroll loads more items
- [ ] Add button stores item locally
- [ ] E2E tests pass

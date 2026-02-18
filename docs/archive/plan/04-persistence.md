# Phase 4: Persistence

## Overview

Persist the user's BiS list using Dexie (IndexedDB) so it survives page refreshes. Add URL sharing to allow users to share their builds.

## Goals

1. Dexie schema for BiS items
2. CRUD operations (add, remove, clear)
3. Load from IndexedDB on startup
4. URL sharing (encode/decode item IDs)
5. E2E tests

## Technical Approach

### Dexie Schema

```typescript
import Dexie, { type EntityTable } from 'dexie'

interface BiSEntry {
  id?: number
  itemId: number
  addedAt: number
  slot: string
}

const db = new Dexie('gear-journey') as Dexie & {
  bisItems: EntityTable<BiSEntry, 'id'>
}

db.version(1).stores({
  bisItems: '++id, itemId, addedAt, slot'
})
```

### Hook for BiS List

```typescript
function useBisList() {
  const [items, setItems] = useState<Item[]>([])

  // Load from IndexedDB on mount
  useEffect(() => {
    db.bisItems.toArray().then(entries => {
      // Load corresponding items from ItemsService
    })
  }, [])

  // Add item
  const addItem = async (item: Item) => {
    await db.bisItems.add({ itemId: item.itemId, addedAt: Date.now(), slot: item.slot })
    setItems(prev => [...prev, item])
  }

  // Remove item
  const removeItem = async (item: Item) => {
    await db.bisItems.where('itemId').equals(item.itemId).delete()
    setItems(prev => prev.filter(i => i.itemId !== item.itemId))
  }

  // Clear all
  const clearAll = async () => {
    await db.bisItems.clear()
    setItems([])
  }

  return { items, addItem, removeItem, clearAll }
}
```

### URL Sharing

Encode item IDs in URL hash for easy sharing:

```typescript
// Encode: [1, 2, 3] -> "#bis=1,2,3"
function encodeBisList(itemIds: number[]): string {
  return `#bis=${itemIds.join(',')}`
}

// Decode: "#bis=1,2,3" -> [1, 2, 3]
function decodeBisList(hash: string): number[] {
  const match = hash.match(/#bis=(.+)/)
  if (!match) return []
  return match[1].split(',').map(Number).filter(n => !isNaN(n))
}
```

On load:
1. Check URL hash for shared build
2. If found, load items from hash (overwrite local)
3. Otherwise, load from IndexedDB

## File Structure

```
app/lib/
├── db.ts              # Dexie database setup
├── url-sharing.ts     # URL encode/decode utilities
└── ...

app/hooks/
├── use-bis-list.ts    # Hook for BiS list with persistence
└── ...
```

## Verification

- [ ] Items persist after page refresh
- [ ] Can add/remove items and they persist
- [ ] Clear all removes from IndexedDB
- [ ] URL sharing encodes/decodes correctly
- [ ] Loading shared URL imports items
- [ ] E2E tests pass

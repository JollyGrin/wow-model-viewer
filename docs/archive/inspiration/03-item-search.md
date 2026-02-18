# Item Search Modal

## Overview

A full-featured search modal for finding and adding items to BiS lists. Features infinite scroll, multi-filter search, and keyboard shortcuts.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/components/ItemSearchModal.tsx` | Search modal component |
| `app/lib/api-client.ts` | Axios client for API calls |
| `app/api/items/route.ts` | Search endpoint |

---

## Component Interface

```typescript
interface ItemSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectItem: (item: Item) => void;
  excludeItemIds?: number[];        // Items already in list
}
```

---

## Search Features

### Text Search
- Searches by `name` (display name)
- Searches by `uniqueName` (URL slug)
- Case-insensitive matching
- Partial match support

### Slot Filter
- Dropdown with all equipment slots
- Single selection
- Clears to show all slots

### Quality Filter
- Dropdown with quality tiers
- Options: Poor, Common, Uncommon, Rare, Epic, Legendary
- Clears to show all qualities

### Level Range
- Min level input (1-60)
- Max level input (1-60)
- Filters by `requiredLevel`

### Class Filter
- Weapon / Armor selection
- Enables subclass filter when selected

### Subclass Filter
- Depends on class selection
- Shows relevant subclasses (Sword, Plate, etc.)

---

## Filter Interface

```typescript
interface ItemSearchFilters {
  query?: string;           // Text search
  slot?: string;            // Equipment slot
  quality?: string;         // Item quality
  minLevel?: number;        // Minimum required level
  maxLevel?: number;        // Maximum required level
  class?: string;           // Item class
  subclass?: string;        // Item subclass
}
```

---

## Infinite Scroll Implementation

### React Query Setup

```typescript
const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
} = useInfiniteQuery({
  queryKey: ['items-search', filters],
  queryFn: ({ pageParam = 1 }) =>
    itemsAPI.search({ ...filters, page: pageParam, limit: 20 }),
  getNextPageParam: (lastPage) => {
    if (lastPage.page < lastPage.totalPages) {
      return lastPage.page + 1;
    }
    return undefined;
  },
  initialPageParam: 1,
});
```

### Intersection Observer

```typescript
import { useInView } from 'react-intersection-observer';

const { ref, inView } = useInView({
  threshold: 0,           // Trigger as soon as element is visible
  rootMargin: '100px',    // Start loading 100px before reaching end
});

useEffect(() => {
  if (inView && hasNextPage && !isFetchingNextPage) {
    fetchNextPage();
  }
}, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

// Render sentinel element at end of list
<div ref={ref} className="h-4" />
```

---

## API Client

```typescript
// app/lib/api-client.ts
import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

export const itemsAPI = {
  search: async (params: ItemSearchFilters & { page?: number; limit?: number }) => {
    const response = await apiClient.get<PaginatedResponse<Item>>('/items', {
      params,
    });
    return response.data;
  },

  getById: async (itemId: number) => {
    const response = await apiClient.get<Item>(`/items/${itemId}`);
    return response.data;
  },

  getBatch: async (itemIds: number[]) => {
    const response = await apiClient.post<Item[]>('/items/batch', { ids: itemIds });
    return response.data;
  },
};
```

---

## Keyboard Shortcuts

```typescript
// Open modal: Cmd+K / Ctrl+K
useHotkeys('mod+k', (e) => {
  e.preventDefault();
  setIsSearchModalOpen(true);
}, { enableOnFormTags: true });

// Close modal: Escape
useHotkeys('escape', () => {
  if (isOpen) onClose();
}, { enableOnFormTags: true });
```

---

## UI Components

### Modal Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ ╔═══════════════════════════════════════════════════════════╗ │
│ ║  [X]                 Search Items                          ║ │
│ ╠═══════════════════════════════════════════════════════════╣ │
│ ║  [🔍 Search items...]                                      ║ │
│ ╠═══════════════════════════════════════════════════════════╣ │
│ ║  Filters:                                                  ║ │
│ ║  [Slot ▼] [Quality ▼] [Min Lv] [Max Lv] [Class ▼]        ║ │
│ ╠═══════════════════════════════════════════════════════════╣ │
│ ║  Results (1,234 items):                                    ║ │
│ ║  ┌────────────────────────────────────────────────────┐   ║ │
│ ║  │ [Icon] Thunderfury                    Lv.60 Epic   │   ║ │
│ ║  │ [Icon] Ashkandi                       Lv.60 Epic   │   ║ │
│ ║  │ [Icon] Deathbringer                   Lv.60 Rare   │   ║ │
│ ║  │ [Icon] ...                                          │   ║ │
│ ║  │ [Loading more...]                                   │   ║ │
│ ║  └────────────────────────────────────────────────────┘   ║ │
│ ╚═══════════════════════════════════════════════════════════╝ │
└─────────────────────────────────────────────────────────────────┘
```

### Item Row

```typescript
interface ItemRowProps {
  item: Item;
  onSelect: (item: Item) => void;
  isExcluded?: boolean;           // Already in list
}

function ItemRow({ item, onSelect, isExcluded }: ItemRowProps) {
  return (
    <button
      onClick={() => !isExcluded && onSelect(item)}
      disabled={isExcluded}
      className={cn(
        'flex items-center gap-3 p-2 hover:bg-wow-light-blue rounded',
        isExcluded && 'opacity-50 cursor-not-allowed'
      )}
    >
      <img
        src={getIconUrl(item.icon, 'medium')}
        alt={item.name}
        className={cn('w-9 h-9 rounded border-2', getQualityBorderClass(item.quality))}
      />
      <div className="flex-1 text-left">
        <div className={cn('font-medium', getQualityTextClass(item.quality))}>
          {item.name}
        </div>
        <div className="text-sm text-gray-400">
          {item.slot} • Lv.{item.requiredLevel}
        </div>
      </div>
    </button>
  );
}
```

---

## Filter State Management

```typescript
const [filters, setFilters] = useState<ItemSearchFilters>({});
const [debouncedQuery, setDebouncedQuery] = useState('');

// Debounce text search to avoid excessive API calls
useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedQuery(filters.query || '');
  }, 300);

  return () => clearTimeout(timer);
}, [filters.query]);

// Update filters
const updateFilter = (key: keyof ItemSearchFilters, value: any) => {
  setFilters(prev => ({
    ...prev,
    [key]: value || undefined,  // Remove empty values
  }));
};

// Clear all filters
const clearFilters = () => {
  setFilters({});
};
```

---

## Search Response

```typescript
interface PaginatedResponse<T> {
  data: T[];                    // Items for this page
  total: number;                // Total matching items
  page: number;                 // Current page (1-indexed)
  limit: number;                // Items per page
  totalPages: number;           // Total pages available
}
```

---

## Error Handling

```typescript
const { error, isError } = useInfiniteQuery({...});

// Display error state
{isError && (
  <div className="text-red-500 p-4 text-center">
    Failed to load items. Please try again.
    <button onClick={() => refetch()} className="ml-2 underline">
      Retry
    </button>
  </div>
)}
```

---

## Loading States

### Initial Load
```typescript
{isLoading && (
  <div className="flex justify-center p-8">
    <Spinner size="lg" />
  </div>
)}
```

### Loading More
```typescript
{isFetchingNextPage && (
  <div className="flex justify-center p-4">
    <Spinner size="sm" />
    <span className="ml-2">Loading more...</span>
  </div>
)}
```

### Empty State
```typescript
{data?.pages[0]?.total === 0 && (
  <div className="text-center p-8 text-gray-400">
    No items found matching your filters.
  </div>
)}
```

---

## Accessibility

- Modal traps focus when open
- Search input auto-focuses on open
- Escape key closes modal
- Proper ARIA labels
- Keyboard navigation for results

---

## Performance Optimizations

### Query Caching
```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,         // 1 minute
      gcTime: 5 * 60 * 1000,        // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});
```

### Virtualization (Future Enhancement)
For very long lists, consider:
- `react-window` for virtualized scrolling
- Only render visible items
- Reduces DOM nodes significantly

### Debounced Search
- 300ms delay on text input
- Prevents API spam during typing
- Better UX and server load

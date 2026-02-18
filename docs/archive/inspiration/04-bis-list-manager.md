# BiS List Manager

## Overview

Manages multiple named BiS (Best-in-Slot) gear lists with localStorage persistence, auto-save, and URL-based sharing.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/components/BisListManager.tsx` | List management UI |
| `app/lib/bis-list-storage.ts` | localStorage wrapper |

---

## Data Structures

### BisList Interface

```typescript
interface BisList {
  id: string;                 // UUID
  name: string;               // User-defined name
  items: Item[];              // Items in the list
  createdAt: Date;            // Creation timestamp
  updatedAt: Date;            // Last modification timestamp
}
```

### Storage Keys

| Key | Purpose |
|-----|---------|
| `wow-bis-lists` | JSON object of all saved lists |
| `wow-bis-active-list` | ID of currently active list |

---

## BisListStorage Service

```typescript
// app/lib/bis-list-storage.ts

class BisListStorage {
  private static readonly LISTS_KEY = 'wow-bis-lists';
  private static readonly ACTIVE_KEY = 'wow-bis-active-list';

  // Get all saved lists
  static getAllLists(): Record<string, BisList> {
    try {
      const data = localStorage.getItem(this.LISTS_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  // Save a list
  static saveList(list: BisList): void {
    const lists = this.getAllLists();
    lists[list.id] = {
      ...list,
      updatedAt: new Date(),
    };
    localStorage.setItem(this.LISTS_KEY, JSON.stringify(lists));
  }

  // Get active list ID
  static getActiveListId(): string | null {
    return localStorage.getItem(this.ACTIVE_KEY);
  }

  // Set active list
  static setActiveList(listId: string): void {
    localStorage.setItem(this.ACTIVE_KEY, listId);
  }

  // Delete a list
  static deleteList(listId: string): void {
    const lists = this.getAllLists();
    delete lists[listId];
    localStorage.setItem(this.LISTS_KEY, JSON.stringify(lists));

    // Clear active if deleted
    if (this.getActiveListId() === listId) {
      localStorage.removeItem(this.ACTIVE_KEY);
    }
  }

  // Auto-save current items to active list
  static autoSaveCurrentList(items: Item[]): void {
    const activeId = this.getActiveListId();
    if (!activeId) return;

    const lists = this.getAllLists();
    if (!lists[activeId]) return;

    lists[activeId].items = items;
    lists[activeId].updatedAt = new Date();
    localStorage.setItem(this.LISTS_KEY, JSON.stringify(lists));
  }
}
```

---

## Component Interface

```typescript
interface BisListManagerProps {
  currentItems: Item[];                   // Items currently displayed
  onLoadList: (items: Item[]) => void;    // Called when loading a list
  onItemsChange?: (items: Item[]) => void;
}
```

---

## UI Components

### List Manager Panel

```
┌─────────────────────────────────────────────────────────────────┐
│ BiS Lists                                           [+ New List] │
├─────────────────────────────────────────────────────────────────┤
│ ○ Warrior Tank (12 items)                    [Edit] [Delete]    │
│ ● Hunter Pre-Raid (18 items) ← Active                           │
│ ○ Mage AQ40 (16 items)                       [Edit] [Delete]    │
├─────────────────────────────────────────────────────────────────┤
│ [Share URL] [Import from URL]                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Create List Dialog

```typescript
interface CreateListDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

function CreateListDialog({ isOpen, onClose, onSubmit }: CreateListDialogProps) {
  const [name, setName] = useState('');

  const handleSubmit = () => {
    if (name.trim()) {
      onSubmit(name.trim());
      setName('');
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose}>
      <DialogTitle>Create New BiS List</DialogTitle>
      <DialogContent>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="List name..."
          autoFocus
        />
      </DialogContent>
      <DialogActions>
        <button onClick={onClose}>Cancel</button>
        <button onClick={handleSubmit}>Create</button>
      </DialogActions>
    </Dialog>
  );
}
```

---

## Auto-Save Mechanism

```typescript
// In page.tsx or BisListManager
const [selectedItems, setSelectedItems] = useState<Item[]>([]);

// Auto-save whenever items change
useEffect(() => {
  const activeList = BisListStorage.getActiveListId();
  if (activeList && selectedItems.length >= 0) {
    BisListStorage.autoSaveCurrentList(selectedItems);
  }
}, [selectedItems]);
```

### Debounced Save (Optional)

```typescript
// Prevent excessive writes
const debouncedSave = useMemo(
  () => debounce((items: Item[]) => {
    BisListStorage.autoSaveCurrentList(items);
  }, 500),
  []
);

useEffect(() => {
  debouncedSave(selectedItems);
}, [selectedItems, debouncedSave]);
```

---

## URL Sharing

### Encoding Format

```typescript
// Encode item IDs to base64 for URL sharing
function encodeListToUrl(items: Item[]): string {
  const itemIds = items.map(item => item.itemId);
  const json = JSON.stringify(itemIds);
  const base64 = btoa(json);

  return `${window.location.origin}?list=${encodeURIComponent(base64)}`;
}

// Decode item IDs from URL
function decodeListFromUrl(param: string): number[] {
  try {
    const json = atob(decodeURIComponent(param));
    return JSON.parse(json);
  } catch {
    return [];
  }
}
```

### Loading from URL

```typescript
// In page.tsx
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const listParam = params.get('list');

  if (listParam) {
    const itemIds = decodeListFromUrl(listParam);
    if (itemIds.length > 0) {
      // Fetch items by IDs
      itemsAPI.getBatch(itemIds).then(items => {
        setSelectedItems(items);
      });
    }
  }
}, []);
```

### Share Button

```typescript
function ShareButton({ items }: { items: Item[] }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = encodeListToUrl(items);
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button onClick={handleShare}>
      {copied ? 'Copied!' : 'Share URL'}
    </button>
  );
}
```

---

## List Operations

### Create List

```typescript
function createNewList(name: string): BisList {
  const newList: BisList = {
    id: crypto.randomUUID(),
    name,
    items: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  BisListStorage.saveList(newList);
  BisListStorage.setActiveList(newList.id);

  return newList;
}
```

### Rename List

```typescript
function renameList(listId: string, newName: string): void {
  const lists = BisListStorage.getAllLists();
  if (lists[listId]) {
    lists[listId].name = newName;
    lists[listId].updatedAt = new Date();
    localStorage.setItem('wow-bis-lists', JSON.stringify(lists));
  }
}
```

### Delete List

```typescript
function deleteList(listId: string): void {
  if (confirm('Are you sure you want to delete this list?')) {
    BisListStorage.deleteList(listId);

    // If this was active list, clear current items
    const activeId = BisListStorage.getActiveListId();
    if (!activeId) {
      onLoadList([]);
    }
  }
}
```

### Duplicate List

```typescript
function duplicateList(listId: string): void {
  const lists = BisListStorage.getAllLists();
  const original = lists[listId];

  if (original) {
    const duplicate: BisList = {
      id: crypto.randomUUID(),
      name: `${original.name} (Copy)`,
      items: [...original.items],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    BisListStorage.saveList(duplicate);
  }
}
```

---

## State Management

```typescript
function BisListManager({ currentItems, onLoadList }: BisListManagerProps) {
  const [lists, setLists] = useState<Record<string, BisList>>({});
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Load lists on mount
  useEffect(() => {
    setLists(BisListStorage.getAllLists());
    setActiveListId(BisListStorage.getActiveListId());
  }, []);

  // Handle list selection
  const handleSelectList = (listId: string) => {
    const list = lists[listId];
    if (list) {
      BisListStorage.setActiveList(listId);
      setActiveListId(listId);
      onLoadList(list.items);
    }
  };

  // Handle new list creation
  const handleCreateList = (name: string) => {
    const newList = createNewList(name);
    setLists(prev => ({ ...prev, [newList.id]: newList }));
    setActiveListId(newList.id);
    onLoadList([]);
  };

  return (
    // ... UI components
  );
}
```

---

## Error Handling

### localStorage Unavailable

```typescript
function isLocalStorageAvailable(): boolean {
  try {
    const test = '__storage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

// Show warning if localStorage unavailable
{!isLocalStorageAvailable() && (
  <div className="text-yellow-500 text-sm">
    localStorage is unavailable. Your lists won't be saved.
  </div>
)}
```

### Corrupted Data Recovery

```typescript
static getAllLists(): Record<string, BisList> {
  try {
    const data = localStorage.getItem(this.LISTS_KEY);
    if (!data) return {};

    const parsed = JSON.parse(data);

    // Validate structure
    if (typeof parsed !== 'object') {
      console.error('Corrupted lists data, resetting');
      localStorage.removeItem(this.LISTS_KEY);
      return {};
    }

    return parsed;
  } catch (e) {
    console.error('Failed to parse lists:', e);
    localStorage.removeItem(this.LISTS_KEY);
    return {};
  }
}
```

---

## Export/Import

### Export to JSON File

```typescript
function exportList(list: BisList): void {
  const data = JSON.stringify(list, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${list.name.replace(/\s+/g, '-')}.json`;
  a.click();

  URL.revokeObjectURL(url);
}
```

### Import from JSON File

```typescript
function importList(file: File): Promise<BisList> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);

        // Validate and create new list
        const imported: BisList = {
          id: crypto.randomUUID(),  // New ID to avoid conflicts
          name: data.name || 'Imported List',
          items: data.items || [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        BisListStorage.saveList(imported);
        resolve(imported);
      } catch (err) {
        reject(new Error('Invalid list file'));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
```

# API Routes

## Overview

RESTful API endpoints for item data access. Built on Next.js App Router with a singleton ItemsService for efficient caching.

---

## Route Summary

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/items` | Search items with filters |
| GET | `/api/items/[id]` | Get single item by ID |
| POST | `/api/items/batch` | Get multiple items by IDs |
| GET | `/api/items/metadata` | Get filter options |
| GET | `/api/item-display-id/[itemId]` | Get display ID for model viewer |
| GET | `/api/wowhead-proxy/[...path]` | Proxy Wowhead CDN assets |

---

## ItemsService (Singleton)

```typescript
// app/lib/items-service.ts

class ItemsService {
  private static instance: ItemsService;
  private items: Item[] | null = null;
  private itemsMap: Map<number, Item> | null = null;
  private lastLoadTime: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  static getInstance(): ItemsService {
    if (!ItemsService.instance) {
      ItemsService.instance = new ItemsService();
    }
    return ItemsService.instance;
  }

  private async loadItems(): Promise<void> {
    const now = Date.now();

    // Return cached if still valid
    if (this.items && (now - this.lastLoadTime) < this.CACHE_DURATION) {
      return;
    }

    // Load from file
    const filePath = path.join(process.cwd(), 'public', 'items.json');
    const data = await fs.readFile(filePath, 'utf-8');
    this.items = JSON.parse(data);

    // Build lookup map
    this.itemsMap = new Map(
      this.items!.map(item => [item.itemId, item])
    );

    this.lastLoadTime = now;
  }

  async getItemById(itemId: number): Promise<Item | null> {
    await this.loadItems();
    return this.itemsMap?.get(itemId) || null;
  }

  async getItemsByIds(itemIds: number[]): Promise<Item[]> {
    await this.loadItems();
    return itemIds
      .map(id => this.itemsMap?.get(id))
      .filter((item): item is Item => item !== undefined);
  }

  async searchItems(params: ItemSearchParams): Promise<PaginatedResponse<Item>> {
    await this.loadItems();

    let filtered = this.items!;

    // Apply filters
    if (params.query) {
      const q = params.query.toLowerCase();
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(q) ||
        item.uniqueName.toLowerCase().includes(q)
      );
    }

    if (params.slot) {
      filtered = filtered.filter(item => item.slot === params.slot);
    }

    if (params.quality) {
      filtered = filtered.filter(item => item.quality === params.quality);
    }

    if (params.minLevel !== undefined) {
      filtered = filtered.filter(item => item.requiredLevel >= params.minLevel!);
    }

    if (params.maxLevel !== undefined) {
      filtered = filtered.filter(item => item.requiredLevel <= params.maxLevel!);
    }

    if (params.class) {
      filtered = filtered.filter(item => item.class === params.class);
    }

    if (params.subclass) {
      filtered = filtered.filter(item => item.subclass === params.subclass);
    }

    // Pagination
    const page = params.page || 1;
    const limit = Math.min(params.limit || 20, 100);
    const start = (page - 1) * limit;
    const end = start + limit;

    const paginatedItems = filtered.slice(start, end);

    return {
      data: paginatedItems,
      total: filtered.length,
      page,
      limit,
      totalPages: Math.ceil(filtered.length / limit),
    };
  }

  async getMetadata(): Promise<ItemsMetadata> {
    await this.loadItems();

    const slots = new Set<string>();
    const qualities = new Set<string>();
    const classes = new Set<string>();
    const subclasses = new Map<string, Set<string>>();

    for (const item of this.items!) {
      if (item.slot) slots.add(item.slot);
      if (item.quality) qualities.add(item.quality);
      if (item.class) {
        classes.add(item.class);
        if (!subclasses.has(item.class)) {
          subclasses.set(item.class, new Set());
        }
        if (item.subclass) {
          subclasses.get(item.class)!.add(item.subclass);
        }
      }
    }

    return {
      slots: Array.from(slots).sort(),
      qualities: Array.from(qualities),
      classes: Array.from(classes).sort(),
      subclasses: Object.fromEntries(
        Array.from(subclasses.entries()).map(([k, v]) => [k, Array.from(v).sort()])
      ),
    };
  }
}

export const itemsService = ItemsService.getInstance();
```

---

## GET /api/items

### Purpose
Search items with filtering and pagination.

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| query | string | Text search (name, uniqueName) |
| slot | string | Equipment slot filter |
| quality | string | Quality filter |
| minLevel | number | Minimum required level |
| maxLevel | number | Maximum required level |
| class | string | Item class filter |
| subclass | string | Item subclass filter |
| page | number | Page number (1-indexed) |
| limit | number | Results per page (max 100) |

### Response

```typescript
interface PaginatedResponse<Item> {
  data: Item[];          // Items for this page
  total: number;         // Total matching items
  page: number;          // Current page
  limit: number;         // Items per page
  totalPages: number;    // Total pages
}
```

### Route Handler

```typescript
// app/api/items/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { itemsService } from '@/app/lib/items-service';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const params = {
    query: searchParams.get('query') || undefined,
    slot: searchParams.get('slot') || undefined,
    quality: searchParams.get('quality') || undefined,
    minLevel: searchParams.get('minLevel')
      ? parseInt(searchParams.get('minLevel')!, 10)
      : undefined,
    maxLevel: searchParams.get('maxLevel')
      ? parseInt(searchParams.get('maxLevel')!, 10)
      : undefined,
    class: searchParams.get('class') || undefined,
    subclass: searchParams.get('subclass') || undefined,
    page: searchParams.get('page')
      ? parseInt(searchParams.get('page')!, 10)
      : 1,
    limit: searchParams.get('limit')
      ? parseInt(searchParams.get('limit')!, 10)
      : 20,
  };

  try {
    const result = await itemsService.searchItems(params);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### Example

```bash
# Search for epic swords level 50+
GET /api/items?query=sword&quality=Epic&minLevel=50&page=1&limit=20
```

---

## GET /api/items/[id]

### Purpose
Get a single item by its ID.

### Route Handler

```typescript
// app/api/items/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { itemsService } from '@/app/lib/items-service';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const itemId = parseInt(params.id, 10);

  if (isNaN(itemId)) {
    return NextResponse.json(
      { error: 'Invalid item ID' },
      { status: 400 }
    );
  }

  try {
    const item = await itemsService.getItemById(itemId);

    if (!item) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(item);
  } catch (error) {
    console.error('Get item error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### Example

```bash
GET /api/items/19019
# Returns Thunderfury item data
```

---

## POST /api/items/batch

### Purpose
Get multiple items by their IDs in a single request.

### Request Body

```typescript
{
  ids: number[];  // Array of item IDs (max 100)
}
```

### Route Handler

```typescript
// app/api/items/batch/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { itemsService } from '@/app/lib/items-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ids = body.ids;

    if (!Array.isArray(ids)) {
      return NextResponse.json(
        { error: 'ids must be an array' },
        { status: 400 }
      );
    }

    if (ids.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 items per request' },
        { status: 400 }
      );
    }

    const items = await itemsService.getItemsByIds(ids);
    return NextResponse.json(items);
  } catch (error) {
    console.error('Batch fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### Example

```bash
POST /api/items/batch
Content-Type: application/json

{
  "ids": [19019, 647, 12345]
}
```

---

## GET /api/items/metadata

### Purpose
Get available filter options for the search UI.

### Response

```typescript
interface ItemsMetadata {
  slots: string[];                          // All equipment slots
  qualities: string[];                      // All quality tiers
  classes: string[];                        // All item classes
  subclasses: Record<string, string[]>;     // Subclasses per class
}
```

### Route Handler

```typescript
// app/api/items/metadata/route.ts
import { NextResponse } from 'next/server';
import { itemsService } from '@/app/lib/items-service';

export async function GET() {
  try {
    const metadata = await itemsService.getMetadata();
    return NextResponse.json(metadata);
  } catch (error) {
    console.error('Metadata error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

---

## GET /api/item-display-id/[itemId]

### Purpose
Map an item ID to its display ID for the 3D model viewer.

### Route Handler

```typescript
// app/api/item-display-id/[itemId]/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { itemId: string } }
) {
  const itemId = parseInt(params.itemId, 10);

  if (isNaN(itemId)) {
    return NextResponse.json(
      { error: 'Invalid item ID' },
      { status: 400 }
    );
  }

  // For Classic WoW, most items use itemId as displayId
  // Could implement lookup table for exceptions
  return NextResponse.json({ displayId: itemId });
}
```

---

## GET /api/wowhead-proxy/[...path]

### Purpose
Proxy requests to Wowhead's CDN to avoid CORS issues.

### Route Handler

```typescript
// app/api/wowhead-proxy/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const path = params.path.join('/');
  const targetUrl = `https://wow.zamimg.com/${path}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible)',
        'Referer': 'https://www.wowhead.com/',
        'Accept': '*/*',
      },
    });

    if (!response.ok) {
      // Return fallback for metadata 404s
      if (path.includes('meta') && response.status === 404) {
        return NextResponse.json({ displayId: 0, itemClass: 0 });
      }

      return new NextResponse('Not found', { status: 404 });
    }

    const data = await response.arrayBuffer();
    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';

    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400', // 24 hour cache
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return new NextResponse('Proxy error', { status: 500 });
  }
}
```

---

## Caching Strategy

### Server-Side (ItemsService)

| Layer | TTL | Description |
|-------|-----|-------------|
| Memory | 5 min | Items array cached in service singleton |
| Map | 5 min | O(1) lookup map refreshed with items |

### Client-Side (React Query)

| Setting | Value | Description |
|---------|-------|-------------|
| staleTime | 60s | Data considered fresh |
| gcTime | 5 min | Cache garbage collection |
| retry | 1 | Single retry on failure |

### HTTP Headers

```typescript
// In next.config.ts
async headers() {
  return [
    {
      source: '/items.json',
      headers: [
        {
          key: 'Cache-Control',
          value: 'public, max-age=3600', // 1 hour
        },
      ],
    },
  ];
}
```

---

## Error Responses

### Standard Error Format

```typescript
interface ErrorResponse {
  error: string;      // Error message
  code?: string;      // Optional error code
  details?: any;      // Optional additional details
}
```

### HTTP Status Codes

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Bad request (invalid params) |
| 404 | Item not found |
| 500 | Internal server error |

---

## Performance Considerations

### Optimization Points

1. **Singleton Pattern**: Single ItemsService instance across requests
2. **Map Lookup**: O(1) access by itemId
3. **Lazy Loading**: Items loaded on first request
4. **Cache TTL**: 5-minute cache prevents repeated file reads
5. **Pagination**: Maximum 100 items per request

### Memory Usage

With ~11,000 items:
- Items array: ~20MB in memory
- Lookup map: ~5MB additional
- Total: ~25MB per service instance

---

## Testing

### Manual Testing

```bash
# Search
curl "http://localhost:3000/api/items?query=thunder&quality=Legendary"

# Single item
curl "http://localhost:3000/api/items/19019"

# Batch
curl -X POST "http://localhost:3000/api/items/batch" \
  -H "Content-Type: application/json" \
  -d '{"ids": [19019, 647]}'

# Metadata
curl "http://localhost:3000/api/items/metadata"
```

### Automated Tests

```typescript
// __tests__/api/items.test.ts
import { GET } from '@/app/api/items/route';

describe('/api/items', () => {
  it('returns paginated results', async () => {
    const request = new Request('http://localhost/api/items?page=1&limit=10');
    const response = await GET(request);
    const data = await response.json();

    expect(data.page).toBe(1);
    expect(data.limit).toBe(10);
    expect(data.data.length).toBeLessThanOrEqual(10);
  });

  it('filters by quality', async () => {
    const request = new Request('http://localhost/api/items?quality=Epic');
    const response = await GET(request);
    const data = await response.json();

    expect(data.data.every((item: Item) => item.quality === 'Epic')).toBe(true);
  });
});
```

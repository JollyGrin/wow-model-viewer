# 3D Model Viewer (Deprecated)

## Status

**This feature is deprecated and may have issues with asset loading.** The model viewer was originally integrated to show a 3D preview of the character with equipped gear.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/components/WowModelViewerFixed.tsx` | Model viewer wrapper |
| `app/model-viewer/page.tsx` | Standalone viewer page |
| `app/api/item-display-id/[itemId]/route.ts` | Display ID lookup |
| `app/api/wowhead-proxy/[...path]/route.ts` | Asset proxy |

---

## Dependencies

```json
{
  "wow-model-viewer": "^1.5.2"
}
```

Additional CDN dependencies:
- jQuery (required by wow-model-viewer)
- Wowhead model assets

---

## Equipment Slot Mapping

```typescript
const SLOT_MAP: Record<string, number> = {
  head: 1,
  neck: 2,
  shoulder: 3,
  shirt: 4,
  chest: 5,
  waist: 6,
  legs: 7,
  feet: 8,
  wrists: 9,
  hands: 10,
  finger1: 11,
  finger2: 12,
  trinket1: 13,
  trinket2: 14,
  back: 15,
  mainHand: 16,
  offHand: 17,
  ranged: 18,
  tabard: 19,
};
```

---

## Race IDs

```typescript
const RACE_IDS: Record<string, number> = {
  human: 1,
  orc: 2,
  dwarf: 3,
  nightelf: 4,
  undead: 5,
  tauren: 6,
  gnome: 7,
  troll: 8,
  bloodelf: 10,
  draenei: 11,
};
```

---

## Component Interface

```typescript
interface WowModelViewerProps {
  race: string;                   // Race key
  gender: 'male' | 'female';
  items?: Record<string, Item>;   // Slot → Item mapping
  className?: string;
}
```

---

## Initialization

```typescript
// Dynamic import (client-side only)
const WowModelViewer = dynamic(
  () => import('./WowModelViewerFixed'),
  { ssr: false }
);

// Component implementation
function WowModelViewerFixed({ race, gender, items }: WowModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize wow-model-viewer
    const initViewer = async () => {
      const { WowModelViewer: Viewer } = await import('wow-model-viewer');

      viewerRef.current = new Viewer({
        container: containerRef.current,
        contentPath: '/api/wowhead-proxy/modelviewer/classic/',
        renderer: 'webgl',
      });

      // Set character
      viewerRef.current.setCharacter({
        race: RACE_IDS[race],
        gender: gender === 'male' ? 0 : 1,
      });
    };

    initViewer();

    return () => {
      viewerRef.current?.destroy();
    };
  }, [race, gender]);

  // Update equipment when items change
  useEffect(() => {
    if (!viewerRef.current || !items) return;

    Object.entries(items).forEach(([slot, item]) => {
      const slotId = SLOT_MAP[slot];
      if (slotId && item) {
        viewerRef.current.setItem(slotId, item.itemId);
      }
    });
  }, [items]);

  return <div ref={containerRef} className="w-full h-full" />;
}
```

---

## Display ID API

Some items require a display ID different from their item ID for the model viewer.

### Route Handler

```typescript
// app/api/item-display-id/[itemId]/route.ts
export async function GET(
  request: Request,
  { params }: { params: { itemId: string } }
) {
  const itemId = parseInt(params.itemId, 10);

  // For Classic WoW, most items use itemId as displayId
  // This endpoint exists for items that need different display IDs

  // Could query external API or maintain lookup table
  // For now, return item ID as fallback
  return Response.json({ displayId: itemId });
}
```

---

## Wowhead Proxy

### Purpose

The model viewer loads assets from Wowhead's CDN. The proxy handles CORS issues and provides fallbacks.

### Route Handler

```typescript
// app/api/wowhead-proxy/[...path]/route.ts
export async function GET(
  request: Request,
  { params }: { params: { path: string[] } }
) {
  const path = params.path.join('/');
  const targetUrl = `https://wow.zamimg.com/${path}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible)',
        'Referer': 'https://www.wowhead.com/',
      },
    });

    if (!response.ok) {
      // Return fallback for 404s on metadata requests
      if (path.includes('meta') && response.status === 404) {
        return Response.json({ displayId: 0, itemClass: 0 });
      }
      throw new Error(`Upstream error: ${response.status}`);
    }

    const data = await response.arrayBuffer();

    return new Response(data, {
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response('Proxy error', { status: 500 });
  }
}
```

---

## Integration with Level Scrubber

When the level scrubber is active, the model viewer updates to show best gear:

```typescript
// In page.tsx
useEffect(() => {
  if (showScrubber && bestItems) {
    // Convert bestItems to model viewer format
    const viewerItems: Record<string, Item> = {};

    Object.entries(bestItems).forEach(([slot, item]) => {
      const viewerSlot = mapSlotToViewerSlot(slot);
      if (viewerSlot) {
        viewerItems[viewerSlot] = item;
      }
    });

    setModelViewerItems(viewerItems);
  }
}, [showScrubber, bestItems]);
```

---

## Champion Preview

Floating preview panel showing character model:

```typescript
function ChampionPreview({
  items,
  race,
  gender,
  onRaceChange,
  onGenderChange
}: ChampionPreviewProps) {
  return (
    <div className="fixed bottom-4 right-4 w-64 h-80 bg-wow-dark-blue rounded-lg shadow-xl">
      <div className="absolute top-2 right-2 flex gap-2">
        <select value={race} onChange={(e) => onRaceChange(e.target.value)}>
          {Object.keys(RACE_IDS).map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select value={gender} onChange={(e) => onGenderChange(e.target.value as 'male' | 'female')}>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </div>

      <WowModelViewer
        race={race}
        gender={gender}
        items={items}
      />
    </div>
  );
}
```

---

## Known Issues

### Asset Loading

1. **CORS Issues**: Some Wowhead assets may block requests
2. **Missing Models**: Not all Classic items have 3D models
3. **Display ID Mapping**: Some items require manual display ID lookup

### Performance

1. **WebGL Context**: Heavy memory usage
2. **Multiple Instances**: Only one viewer instance recommended
3. **Hot Reloading**: May cause WebGL context loss during development

### Deprecation Reasons

1. Maintenance overhead for proxy and display ID mapping
2. Limited value compared to Wowhead's own model viewer
3. Asset availability and CORS issues

---

## Alternative Approaches

### Link to Wowhead Viewer

```typescript
function getWowheadModelViewerUrl(itemId: number): string {
  return `https://www.wowhead.com/classic/item=${itemId}#modelviewer`;
}
```

### Static Item Images

```typescript
function getItemRenderUrl(displayId: number): string {
  return `https://wow.zamimg.com/renders/items/${displayId}.jpg`;
}
```

---

## Removal Checklist

If fully removing the model viewer:

1. Delete `app/components/WowModelViewerFixed.tsx`
2. Delete `app/model-viewer/` directory
3. Delete `app/api/item-display-id/` directory
4. Delete `app/api/wowhead-proxy/` directory
5. Remove `wow-model-viewer` from `package.json`
6. Remove jQuery CDN script from `layout.tsx`
7. Remove related state from `page.tsx`
8. Update UI to remove viewer toggle/preview

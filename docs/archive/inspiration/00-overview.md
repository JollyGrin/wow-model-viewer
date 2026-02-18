# WoW BiS Leveling Tool - Complete Overview

## Purpose

A web application for World of Warcraft Classic/Turtle WoW players to track and visualize the best-in-slot (BiS) gear progression for each equipment slot while leveling from 1-60. Includes a deprecated 3D model viewer for visualizing equipped gear.

---

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 15.5.2 with React 19.1.0 |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS v4 |
| State Management | TanStack React Query v5 |
| HTTP Client | Axios |
| Data Scraping | Puppeteer v24 |
| 3D Viewer | wow-model-viewer (npm) |
| Package Manager | pnpm |

---

## Project Structure

```
wow-bis/
├── app/
│   ├── api/                    # Backend API routes
│   │   ├── items/              # Item CRUD operations
│   │   ├── item-display-id/    # Model viewer mapping
│   │   └── wowhead-proxy/      # CDN proxy for assets
│   ├── components/             # React components
│   │   ├── EquipmentSlot.tsx   # Timeline visualization
│   │   ├── ItemSearchModal.tsx # Search interface
│   │   ├── BisListManager.tsx  # List CRUD
│   │   └── WowModelViewerFixed.tsx
│   ├── lib/                    # Services & utilities
│   │   ├── items-service.ts    # Singleton item service
│   │   ├── api-client.ts       # Axios client
│   │   └── bis-list-storage.ts # localStorage wrapper
│   ├── model-viewer/           # 3D viewer page
│   ├── globals.css             # WoW-themed styles
│   ├── layout.tsx              # Root layout + Wowhead tooltips
│   └── page.tsx                # Main BiS interface
├── public/
│   └── items.json              # 10,951 items (~9.5MB)
├── scripts/                    # Data scraping scripts
│   ├── extract-item-ids.ts     # Phase 1: Get IDs
│   ├── item-extractor.ts       # Phase 2: Scrape details
│   ├── process-item-details.ts # Phase 3: Process data
│   ├── reorganize-items.ts     # Phase 4: Merge data
│   └── process-quest-levels.ts # Phase 5: Fix quest levels
└── turtle_db/                  # Scraped data artifacts
```

---

## High-Level Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                        DATA COLLECTION                           │
│ Turtle WoW DB → Puppeteer Scraper → turtle_db/ → items.json     │
└──────────────────────────────────────────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────────┐
│                        BACKEND API                               │
│ ItemsService (singleton) ← items.json                           │
│       ↓                                                          │
│ /api/items → Search, Filter, Paginate (20/page)                 │
│ /api/items/[id] → Single item lookup                            │
│ /api/items/batch → Bulk fetch (max 100)                         │
└──────────────────────────────────────────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────────┐
│                        FRONTEND UI                               │
│ React Query Cache ← API Responses                                │
│       ↓                                                          │
│ ItemSearchModal → User searches/filters items                    │
│       ↓                                                          │
│ BisListManager → User builds BiS lists (localStorage)           │
│       ↓                                                          │
│ EquipmentSlotList → Timeline visualization by slot              │
│       ↓                                                          │
│ WowModelViewer → 3D character preview (deprecated)              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Core Data: Item Structure

```typescript
interface Item {
  itemId: number;              // Unique identifier
  name: string;                // Display name
  icon: string;                // Icon filename (e.g., "inv_sword_19")
  class: string;               // Weapon, Armor, etc.
  subclass: string;            // Sword, Plate, etc.
  quality: string;             // Poor|Common|Uncommon|Rare|Epic|Legendary
  itemLevel: number;           // Affects stats
  requiredLevel: number;       // Min level to equip
  slot: string;                // Equipment slot
  tooltip: TooltipLine[];      // Rich tooltip data
  itemLink: string;            // WoW hyperlink format
  contentPhase: number;        // Classic phase (1-6)
  source?: ItemSource;         // How to obtain
  uniqueName: string;          // URL-friendly slug
}
```

See: [01-data-structure.md](./01-data-structure.md)

---

## Core Functionalities

### 1. BiS Timeline Visualization
Horizontal bars showing gear progression levels 1-60. Items positioned by `requiredLevel`, color-coded by quality.

See: [02-bis-timeline.md](./02-bis-timeline.md)

### 2. Item Search & Filtering
Modal with infinite scroll, multi-filter search (name, slot, quality, level range), keyboard shortcuts (Cmd+K).

See: [03-item-search.md](./03-item-search.md)

### 3. BiS List Management
Create, save, load multiple named lists. Auto-save to localStorage. URL-based sharing via base64 encoding.

See: [04-bis-list-manager.md](./04-bis-list-manager.md)

### 4. Level Scrubber (Interactive)
Draggable bar to scrub through levels 1-60. Calculates best item per slot for current level.

See: [02-bis-timeline.md](./02-bis-timeline.md)

### 5. 3D Model Viewer (Deprecated)
Real-time character preview with equipped items. Race/gender selection. Uses wow-model-viewer library.

See: [05-3d-model-viewer.md](./05-3d-model-viewer.md)

### 6. Data Scraping Pipeline
5-phase scraping from Turtle WoW database. Puppeteer with anti-detection. Progress tracking and resume capability.

See: [06-data-scraping.md](./06-data-scraping.md)

### 7. API Routes
RESTful endpoints for item search, batch fetch, metadata. Singleton service with 5-minute cache.

See: [07-api-routes.md](./07-api-routes.md)

---

## Parsing Logic

### Icon URLs
```
Item icon field: "inv_sword_19"
         ↓
Construct: https://wow.zamimg.com/images/wow/icons/{size}/{icon}.jpg
Sizes: small (18px), medium (36px), large (56px)
```

### Quality Colors
```
Epic      → #a335ee (purple)
Rare      → #0070dd (blue)
Uncommon  → #1eff00 (green)
Common    → #ffffff (white)
Poor      → #9d9d9d (gray)
```

### Level Position Calculation
```typescript
// Position on 1-60 timeline bar
position = ((requiredLevel - 1) / 59) * 100  // percentage
```

### Tooltip Parsing
```typescript
interface TooltipLine {
  label: string;              // Text content
  format?: string;            // alignRight | indent | Misc | quality colors
}
// Formats determine display style in tooltip UI
```

---

## Persistence

| Storage | Key | Data |
|---------|-----|------|
| localStorage | `wow-bis-lists` | All saved BiS lists |
| localStorage | `wow-bis-active-list` | Current list ID |
| React Query | `items-search` | Cached search results |
| Server | ItemsService cache | items.json (5 min TTL) |

---

## External Dependencies

| Service | URL | Purpose |
|---------|-----|---------|
| Zamimg CDN | `wow.zamimg.com/images/wow/icons/` | Item icons |
| Wowhead Tooltips | `wow.zamimg.com/js/tooltips.js` | Hover tooltips |
| Turtle WoW DB | `database.turtle-wow.org` | Data source |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` / `Ctrl+K` | Open item search |
| `Cmd+J` / `Ctrl+J` | Toggle level scrubber |
| `Escape` | Close modal |

---

## Known Issues

1. **Quest Item Levels**: Quest rewards show `requiredLevel: 0` instead of quest minimum level
2. **Quality Colors**: Some items display wrong border color (e.g., Gloves of the Fang)
3. **Model Viewer**: Deprecated, may have asset loading issues

---

## Related Documentation

- [01-data-structure.md](./01-data-structure.md) - Item schema and data organization
- [02-bis-timeline.md](./02-bis-timeline.md) - Timeline and scrubber features
- [03-item-search.md](./03-item-search.md) - Search modal implementation
- [04-bis-list-manager.md](./04-bis-list-manager.md) - List persistence
- [05-3d-model-viewer.md](./05-3d-model-viewer.md) - Model viewer integration
- [06-data-scraping.md](./06-data-scraping.md) - Scraping pipeline
- [07-api-routes.md](./07-api-routes.md) - Backend API structure

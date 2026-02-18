# Data Scraping Pipeline

## Overview

A 5-phase scraping pipeline that collects item data from the Turtle WoW database and processes it into a unified `items.json` file.

---

## Data Source

| Property | Value |
|----------|-------|
| Database | Turtle WoW |
| Base URL | `https://database.turtle-wow.org` |
| Items List | `/?items={category}` |
| Item Detail | `/?item={itemId}` |
| Quest Detail | `/?quest={questId}` |

---

## Pipeline Overview

```
┌──────────────────────────────────────────────────────────────────┐
│ Phase 1: Extract Item IDs                                        │
│ scripts/extract-item-ids.ts                                      │
│ Output: id-extraction-progress.json, items-{category}.json IDs   │
└──────────────────────────────────────────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────────┐
│ Phase 2: Scrape Item Details                                     │
│ scripts/item-extractor.ts (or process-item-details.ts)           │
│ Output: Individual item files, category JSON files               │
└──────────────────────────────────────────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────────┐
│ Phase 3: Merge & Deduplicate                                     │
│ scripts/reorganize-items.ts                                      │
│ Output: Merged items array                                       │
└──────────────────────────────────────────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────────┐
│ Phase 4: Fix Quest Levels                                        │
│ scripts/process-quest-levels.ts                                  │
│ Output: Items with correct requiredLevel for quest rewards       │
└──────────────────────────────────────────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────────┐
│ Phase 5: Copy to Production                                      │
│ Copy final items.json to public/items.json                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Extract Item IDs

### Script
`scripts/extract-item-ids.ts`

### Purpose
Get all item IDs for each category from the Turtle WoW database.

### Category Codes

```typescript
const CATEGORIES = [
  // Weapons
  '2.0',   // One-handed Axes
  '2.1',   // Two-handed Axes
  '2.2',   // Bows
  '2.3',   // Guns
  '2.4',   // One-handed Maces
  '2.5',   // Two-handed Maces
  '2.6',   // Polearms
  '2.7',   // One-handed Swords
  '2.8',   // Two-handed Swords
  '2.10',  // Staves
  '2.13',  // Fist Weapons
  '2.14',  // Miscellaneous
  '2.15',  // Daggers
  '2.16',  // Thrown
  '2.17',  // Spears
  '2.18',  // Crossbows
  '2.19',  // Wands
  '2.20',  // Fishing Poles

  // Accessories
  '4.0.2',  // Amulets
  '4.0.11', // Rings
  '4.0.12', // Trinkets
  '4.1.16', // Cloaks
  '4.6.14', // Shields

  // Cloth Armor
  '4.1.1', '4.1.3', '4.1.5', '4.1.6', '4.1.7', '4.1.8', '4.1.9', '4.1.10',

  // Leather Armor
  '4.2.1', '4.2.3', '4.2.5', '4.2.6', '4.2.7', '4.2.8', '4.2.9', '4.2.10',

  // Mail Armor
  '4.3.1', '4.3.3', '4.3.5', '4.3.6', '4.3.7', '4.3.8', '4.3.9', '4.3.10',

  // Plate Armor
  '4.4.1', '4.4.3', '4.4.5', '4.4.6', '4.4.7', '4.4.8', '4.4.9', '4.4.10',
];
```

### Pagination

The database uses hash-based pagination:
- Page 1: `/?items={category}`
- Page 2: `/?items={category}#50+1`
- Page 3: `/?items={category}#100+1`
- And so on...

### Output

```
turtle_db/
├── id-extraction-progress.json    # Progress tracking for resume
├── items-2.0.json                 # IDs for one-handed axes
├── items-2.1.json                 # IDs for two-handed axes
└── ...                            # Category-specific ID lists
```

---

## Phase 2: Scrape Item Details

### Script
`scripts/item-extractor.ts` or `scripts/process-item-details.ts`

### Purpose
Scrape full item details for each ID collected in Phase 1.

### Puppeteer Configuration

```typescript
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
  ],
});

const page = await browser.newPage();

// Anti-detection measures
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});

await page.setUserAgent(
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
);

await page.setExtraHTTPHeaders({
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
});
```

### Extracted Data

```typescript
interface ScrapedItem {
  itemId: number;
  name: string;
  icon: string;              // Extracted from icon element
  class: string;             // From item info section
  subclass: string;
  sellPrice: number;         // Parsed from copper/silver/gold display
  quality: string;           // From name color class
  itemLevel: number;
  requiredLevel: number;
  slot: string;
  tooltip: TooltipLine[];    // From tooltip div
  itemLink: string;          // Constructed from item data
  contentPhase: number;      // From phase indicator
  source: ItemSource;        // From source section
  uniqueName: string;        // Generated slug
}
```

### Rate Limiting

```typescript
const DELAY_BETWEEN_REQUESTS = 1500; // 1.5 seconds

async function scrapeWithDelay(itemId: number): Promise<ScrapedItem> {
  const result = await scrapeItem(itemId);
  await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
  return result;
}
```

### Progress Tracking

```typescript
interface ScrapeProgress {
  category: string;
  completed: number[];
  failed: number[];
  total: number;
}

// Save progress after each item
function saveProgress(progress: ScrapeProgress): void {
  fs.writeFileSync(
    'turtle_db/scrape-progress.json',
    JSON.stringify(progress, null, 2)
  );
}
```

### Error Handling

```typescript
async function scrapeItem(itemId: number, retries = 3): Promise<ScrapedItem | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await doScrape(itemId);
      return result;
    } catch (error) {
      console.error(`Attempt ${attempt} failed for item ${itemId}:`, error);

      // Check for Cloudflare challenge
      if (error.message.includes('Cloudflare')) {
        console.log('Waiting for Cloudflare cooldown...');
        await new Promise(resolve => setTimeout(resolve, 30000));
      }

      if (attempt === retries) {
        logFailedItem(itemId, error.message);
        return null;
      }

      // Exponential backoff
      await new Promise(resolve =>
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }
  return null;
}
```

---

## Phase 3: Merge & Deduplicate

### Script
`scripts/reorganize-items.ts`

### Purpose
Combine all category-specific item files into a single items.json.

### Logic

```typescript
async function mergeItems(): Promise<void> {
  const allItems: Item[] = [];
  const seenIds = new Set<number>();

  // Read all category files
  const categoryFiles = fs.readdirSync('turtle_db')
    .filter(f => f.startsWith('items-') && f.endsWith('.json'));

  for (const file of categoryFiles) {
    const items = JSON.parse(
      fs.readFileSync(`turtle_db/${file}`, 'utf-8')
    );

    for (const item of items) {
      // Deduplicate by itemId
      if (!seenIds.has(item.itemId)) {
        seenIds.add(item.itemId);
        allItems.push(item);
      }
    }
  }

  // Sort by itemId for consistent ordering
  allItems.sort((a, b) => a.itemId - b.itemId);

  // Write merged file
  fs.writeFileSync(
    'turtle_db/items.json',
    JSON.stringify(allItems, null, 2)
  );

  console.log(`Merged ${allItems.length} unique items`);
}
```

---

## Phase 4: Fix Quest Levels

### Script
`scripts/process-quest-levels.ts`

### Problem

Quest reward items have `requiredLevel: 0` because they don't have an intrinsic level requirement. However, they should use the quest's minimum level.

### Solution

```typescript
async function fixQuestLevels(): Promise<void> {
  const items = JSON.parse(fs.readFileSync('turtle_db/items.json', 'utf-8'));
  const questCache = new Map<number, number>(); // questId → minLevel

  for (const item of items) {
    // Skip items that already have a level
    if (item.requiredLevel > 0) continue;

    // Skip non-quest items
    if (item.source?.category !== 'Quest') continue;

    // Get quest minimum level
    const questId = item.source.quests?.[0]?.id;
    if (!questId) continue;

    let minLevel = questCache.get(questId);

    if (minLevel === undefined) {
      minLevel = await scrapeQuestMinLevel(questId);
      questCache.set(questId, minLevel);
    }

    if (minLevel > 0) {
      item.requiredLevel = minLevel;
    }
  }

  fs.writeFileSync(
    'turtle_db/items.json',
    JSON.stringify(items, null, 2)
  );
}

async function scrapeQuestMinLevel(questId: number): Promise<number> {
  try {
    const page = await browser.newPage();
    await page.goto(`https://database.turtle-wow.org/?quest=${questId}`);

    // Extract minimum level from quest page
    const minLevel = await page.evaluate(() => {
      const levelElement = document.querySelector('.quest-min-level');
      return levelElement ? parseInt(levelElement.textContent || '0', 10) : 0;
    });

    await page.close();
    return minLevel;
  } catch (error) {
    console.error(`Failed to get quest ${questId} min level:`, error);
    return 0;
  }
}
```

---

## Phase 5: Deploy to Production

### Manual Step

```bash
# Copy final items.json to public directory
cp turtle_db/items.json public/items.json

# Verify file size
ls -lh public/items.json

# Restart dev server to pick up changes
# (items are cached server-side)
```

---

## Running the Pipeline

### Full Pipeline

```bash
# Phase 1: Extract IDs
npx tsx scripts/extract-item-ids.ts

# Phase 2: Scrape Details
npx tsx scripts/process-item-details.ts

# Phase 3: Merge
npx tsx scripts/reorganize-items.ts

# Phase 4: Fix Quest Levels
npx tsx scripts/process-quest-levels.ts

# Phase 5: Deploy
cp turtle_db/items.json public/items.json
```

### Resume After Failure

The pipeline saves progress granularly, allowing resume:

```typescript
// Check for existing progress
const progress = fs.existsSync('turtle_db/scrape-progress.json')
  ? JSON.parse(fs.readFileSync('turtle_db/scrape-progress.json', 'utf-8'))
  : { completed: [], failed: [], total: 0 };

// Skip already completed items
const remaining = allIds.filter(id => !progress.completed.includes(id));
```

---

## Output Files

### Production

| File | Description |
|------|-------------|
| `public/items.json` | Final merged item data (~9.5MB, 10,951 items) |

### Artifacts

| File | Description |
|------|-------------|
| `turtle_db/extraction-summary.json` | Summary of last extraction |
| `turtle_db/failed-items.json` | Items that failed to scrape |
| `turtle_db/failed-quest-ids.json` | Quest IDs that failed |
| `turtle_db/id-extraction-progress.json` | ID extraction progress |
| `turtle_db/items-{category}.json` | Category-specific items |

---

## Estimated Runtime

| Phase | Duration | Notes |
|-------|----------|-------|
| Phase 1 | ~30 min | Depends on pagination count |
| Phase 2 | 2-4 hours | 1.5s per item × ~10,000 items |
| Phase 3 | ~1 min | Fast local file processing |
| Phase 4 | ~30 min | Quest level lookups |
| Phase 5 | Instant | File copy |

**Total: ~3-5 hours** (mostly waiting for Phase 2)

---

## Maintenance

### Re-scraping

To update the database with new items:

1. Run Phase 1 to get new IDs
2. Compare with existing items.json
3. Scrape only new IDs (Phase 2 partial)
4. Merge new items into existing (Phase 3 modified)
5. Fix quest levels for new items (Phase 4 partial)

### Incremental Updates

```typescript
async function scrapeNewItems(): Promise<void> {
  const existingIds = new Set(
    JSON.parse(fs.readFileSync('public/items.json', 'utf-8'))
      .map((item: Item) => item.itemId)
  );

  const allIds = await extractAllItemIds();
  const newIds = allIds.filter(id => !existingIds.has(id));

  console.log(`Found ${newIds.length} new items to scrape`);

  // Scrape only new items
  for (const id of newIds) {
    await scrapeItem(id);
  }
}
```

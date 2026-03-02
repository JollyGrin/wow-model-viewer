/**
 * Download and parse the thatsmybis classic-wow-item-db SQL dump.
 *
 * Downloads data/external/unmodified.sql (skips if already present),
 * parses INSERT rows, extracts 7 fields per item, writes data/external/items.json.
 *
 * Usage: bun run scripts/parse-item-db.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const SQL_URL = 'https://raw.githubusercontent.com/thatsmybis/classic-wow-item-db/master/db/unmodified.sql';
const SQL_PATH = resolve(ROOT, 'data/external/unmodified.sql');
const OUT_PATH = resolve(ROOT, 'data/external/items.json');

// INSERT column order (0-indexed):
//   0: item_id, 1: patch, 2: class, 3: subclass, 4: name, 5: description,
//   6: display_id, 7: quality, 8: flags, 9: buy_count, 10: buy_price,
//   11: sell_price, 12: inventory_type, ...
const COL_ITEM_ID = 0;
const COL_PATCH = 1;
const COL_CLASS = 2;
const COL_SUBCLASS = 3;
const COL_NAME = 4;
const COL_DISPLAY_ID = 6;
const COL_QUALITY = 7;
const COL_INVENTORY_TYPE = 12;

const NEEDED_COLS = new Set([COL_ITEM_ID, COL_PATCH, COL_CLASS, COL_SUBCLASS, COL_NAME, COL_DISPLAY_ID, COL_QUALITY, COL_INVENTORY_TYPE]);
const MAX_COL = Math.max(...NEEDED_COLS);

interface Item {
  itemId: number;
  name: string;
  displayId: number;
  inventoryType: number;
  quality: number;
  class: number;
  subclass: number;
}

/**
 * Parse a SQL value tuple row like: (25, 0, 2, 7, 'Worn Shortsword', '', 1542, 1, ...)
 * Uses a state machine to handle SQL string quoting with escaped single quotes.
 * Returns the field values as strings, only up to MAX_COL.
 */
function parseRow(line: string): string[] | null {
  // Find opening paren
  const start = line.indexOf('(');
  if (start === -1) return null;

  const fields: string[] = [];
  let i = start + 1;
  const len = line.length;

  while (i < len && fields.length <= MAX_COL) {
    // Skip whitespace
    while (i < len && line[i] === ' ') i++;

    if (line[i] === "'") {
      // String value — scan to unescaped closing quote
      i++; // skip opening quote
      let val = '';
      while (i < len) {
        if (line[i] === "'" && i + 1 < len && line[i + 1] === "'") {
          // Escaped quote ''
          val += "'";
          i += 2;
        } else if (line[i] === '\\' && i + 1 < len && line[i + 1] === "'") {
          // Escaped quote \'
          val += "'";
          i += 2;
        } else if (line[i] === "'") {
          // End of string
          i++; // skip closing quote
          break;
        } else {
          val += line[i];
          i++;
        }
      }
      fields.push(val);
    } else {
      // Numeric or NULL value — scan to comma or closing paren
      let val = '';
      while (i < len && line[i] !== ',' && line[i] !== ')') {
        val += line[i];
        i++;
      }
      fields.push(val.trim());
    }

    // Skip comma separator
    while (i < len && (line[i] === ',' || line[i] === ' ')) {
      if (line[i] === ',') { i++; break; }
      i++;
    }

    // Stop early if we have all we need
    if (fields.length > MAX_COL) break;
  }

  return fields.length > MAX_COL ? fields : null;
}

async function main() {
  // --- Download SQL if needed ---
  if (existsSync(SQL_PATH)) {
    console.log(`SQL file exists, skipping download: ${SQL_PATH}`);
  } else {
    console.log(`Downloading SQL dump from GitHub...`);
    const resp = await fetch(SQL_URL);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
    const text = await resp.text();
    writeFileSync(SQL_PATH, text);
    console.log(`Saved ${(text.length / 1024 / 1024).toFixed(1)}MB to ${SQL_PATH}`);
  }

  // --- Parse SQL ---
  console.log('Parsing SQL...');
  const sql = readFileSync(SQL_PATH, 'utf-8');
  const lines = sql.split('\n');

  // Dedup: SQL has multiple rows per itemId (different patch versions).
  // Keep the highest patch version for each itemId.
  const itemMap = new Map<number, Item & { patch: number }>();
  let totalRows = 0;
  let parseErrors = 0;

  for (const line of lines) {
    // Data rows start with tab + open paren
    if (!line.startsWith('\t(')) continue;
    totalRows++;

    const fields = parseRow(line);
    if (!fields) {
      parseErrors++;
      continue;
    }

    const itemId = parseInt(fields[COL_ITEM_ID], 10);
    const patch = parseInt(fields[COL_PATCH], 10);
    const displayId = parseInt(fields[COL_DISPLAY_ID], 10);
    const quality = parseInt(fields[COL_QUALITY], 10);
    const cls = parseInt(fields[COL_CLASS], 10);
    const subclass = parseInt(fields[COL_SUBCLASS], 10);
    const inventoryType = parseInt(fields[COL_INVENTORY_TYPE], 10);
    const name = fields[COL_NAME];

    if (isNaN(itemId) || isNaN(displayId)) {
      parseErrors++;
      continue;
    }

    const existing = itemMap.get(itemId);
    if (!existing || patch > existing.patch) {
      itemMap.set(itemId, { itemId, name, displayId, inventoryType, quality, class: cls, subclass, patch });
    }
  }

  // Strip patch field from output
  const items: Item[] = [...itemMap.values()].map(({ patch, ...rest }) => rest);

  // --- Write output ---
  writeFileSync(OUT_PATH, JSON.stringify(items));
  console.log(`Wrote ${items.length} items to ${OUT_PATH}`);

  // --- Verification ---
  console.log('\n=== Summary ===');
  console.log(`SQL rows:     ${totalRows}`);
  console.log(`Unique items: ${items.length} (deduped by highest patch)`);
  console.log(`Parse errors: ${parseErrors}`);

  // Breakdown by inventoryType
  const byType = new Map<number, number>();
  for (const item of items) {
    byType.set(item.inventoryType, (byType.get(item.inventoryType) || 0) + 1);
  }

  const TYPE_NAMES: Record<number, string> = {
    0: 'Non-equippable', 1: 'Head', 2: 'Neck', 3: 'Shoulder', 4: 'Shirt',
    5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrists',
    10: 'Hands', 11: 'Finger', 12: 'Trinket', 13: 'One-Hand',
    14: 'Shield', 15: 'Ranged(Bow)', 16: 'Back', 17: 'Two-Hand',
    18: 'Bag', 19: 'Tabard', 20: 'Robe', 21: 'Main Hand',
    22: 'Off Hand', 23: 'Held In Off-Hand', 24: 'Ammo', 25: 'Thrown',
    26: 'Ranged(Gun/Wand)', 28: 'Relic',
  };

  console.log('\nBy inventory type:');
  const sorted = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sorted) {
    const label = TYPE_NAMES[type] || `Type ${type}`;
    console.log(`  ${label} (${type}): ${count}`);
  }

  // Spot-check Thunderfury
  const thunderfury = items.find(i => i.itemId === 19019);
  if (thunderfury) {
    console.log(`\nSpot-check — Thunderfury: displayId=${thunderfury.displayId}, quality=${thunderfury.quality}, inventoryType=${thunderfury.inventoryType}`);
  } else {
    console.error('\nWARNING: Thunderfury (itemId=19019) not found!');
  }

  // Spot-check Worn Shortsword (first item)
  const wornShortsword = items.find(i => i.itemId === 25);
  if (wornShortsword) {
    console.log(`Spot-check — Worn Shortsword: displayId=${wornShortsword.displayId}, name="${wornShortsword.name}"`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

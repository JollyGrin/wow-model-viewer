# Display ID Mapping: Research & Data Sources

## Summary

The `displayId` field is missing from all 10,951 items in `items.json`. Two external data sources are needed to build the full mapping chain:

```
itemId → displayId → model/texture/icon
```

## Data Sources

### 1. thatsmybis/classic-wow-item-db (itemId → displayId bridge)

- **Repo**: https://github.com/thatsmybis/classic-wow-item-db
- **File**: `db/unmodified.sql` (8.8 MB, ~19,679 items)
- **Column order**: `item_id, patch, class, subclass, name, description, display_id, ...`
- **Coverage**: Vanilla Classic items only (item_id < ~24,000)
- **Local path**: `data/external/item_template.sql`

### 2. Turtle-WOW-DBC (displayId → model info)

- **Repo**: https://github.com/oplancelot/Turtle-WOW-DBC
- **File**: `dbc.MPQ/DBFilesClient/ItemDisplayInfo.json` (9.9 MB, 23,852 records)
- **Schema**: `ID` (displayId), `ModelName1`, `ModelTexture1`, `InventoryIcon1`, etc.
- **Coverage**: Vanilla + Turtle WoW custom display entries
- **Local path**: `data/external/ItemDisplayInfo.json`

## Verified End-to-End Chain

```
items.json:           itemId 647 (Destiny), icon "inv_sword_19"
                         ↓
item_template.sql:    item_id=647 → display_id=20190
                         ↓
ItemDisplayInfo.json: ID=20190
                      → ModelName1: "Sword_2H_Claymore_C_01.mdx"
                      → ModelTexture1: "Sword_1H_Long_D_01_V01"
                      → InventoryIcon1: "INV_Sword_19" ✓ matches
```

## Key Findings

### No Item.dbc exists in the Turtle-WOW-DBC repo

The critical `itemId → displayId` mapping is **not** in the Turtle-WOW-DBC repo. In vanilla 1.12.x, `Item.dbc` doesn't exist client-side — that mapping lives server-side in the `item_template` SQL table. This is why we need the thatsmybis SQL dump as a bridge.

### Icons are NOT unique

The same `InventoryIcon1` value can map to 14+ different display IDs (e.g., `INV_Sword_19`). You cannot use icons as a proxy for the `itemId → displayId` mapping.

### Coverage gaps

| Item ID Range | Count | Has displayId via SQL? |
|---------------|-------|------------------------|
| < 30,000 (vanilla) | ~9,400 (86%) | Yes |
| 30,000 - 40,000 (TBC-era) | ~796 | Partial |
| 40,000+ (Turtle custom) | ~588 | No — need Turtle WoW server DB |
| 50,000+ | ~10 | No |

### ItemDisplayInfo.json schema

```json
{
  "ID": 20190,
  "ModelName1": "Sword_2H_Claymore_C_01.mdx",
  "ModelName2": "",
  "ModelTexture1": "Sword_1H_Long_D_01_V01",
  "ModelTexture2": "",
  "InventoryIcon1": "INV_Sword_19",
  "GeosetGroup_1": 0, "GeosetGroup_2": 0, "GeosetGroup_3": 0,
  "Flags": 0,
  "SpellVisualID": 0,
  "GroupSoundIndex": 9,
  "HelmetGeosetVis_1": 0, "HelmetGeosetVis_2": 0,
  "Texture1": "" ... "Texture8": "",
  "ItemVisual": 0
}
```

- 23,852 total records (displayId range 220–29,059)
- 7,054 records have a 3D model (`ModelName1` populated) — weapons, shields, etc.
- 16,798 records have no model — armor pieces that use textures instead

## Next Steps

1. Parse the SQL to extract `{itemId: displayId}` as JSON lookup
2. Cross-reference against our `items.json` to measure actual coverage
3. Add `displayId` to items during data pipeline (or as separate lookup file)
4. Implement fallback icons for items without displayId coverage

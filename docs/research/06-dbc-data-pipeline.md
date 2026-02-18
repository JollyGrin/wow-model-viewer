# 06 - DBC Data Pipeline

## The Critical Data Chain

The fundamental mapping for rendering any equipped item:

```
itemId -> displayId -> model files + texture files + geoset info
```

---

## The Problem: itemId -> displayId Bridge

In vanilla 1.12.x, `Item.dbc` does NOT exist in the client. The `itemId -> displayId` mapping is **server-side only** (in the `item_template` SQL table). The client receives `displayId` via `SMSG_ITEM_QUERY_SINGLE_RESPONSE` at runtime.

### Solution: External Data Sources

| Source | What It Provides | Records |
|--------|-----------------|---------|
| `thatsmybis/classic-wow-item-db` | SQL dump with `itemId -> displayId` | ~19,679 items |
| `oplancelot/Turtle-WOW-DBC` | `ItemDisplayInfo.dbc` as JSON | 23,852 display records |

**Coverage**:
- ~9,400 vanilla items (86%): Covered by the SQL dump
- ~1,550 Turtle WoW custom items (14%): Need Turtle WoW's server database for `itemId -> displayId`
- 7,054 records have a 3D model (ModelName1 populated) -- weapons, shields, helmets, shoulders
- 16,798 records are texture-only items (armor overlays on character body)

---

## Essential DBC Files

### ItemDisplayInfo.dbc -- THE Most Important

Maps `displayId` to all visual information needed to render an item.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| 0 | ID | int | Display ID (primary key) |
| 1 | ModelName1 | string | Primary M2 model filename |
| 2 | ModelName2 | string | Secondary model (dual-wield, paired shoulders) |
| 3 | ModelTexture1 | string | Texture override for model 1 |
| 4 | ModelTexture2 | string | Texture override for model 2 |
| 5 | InventoryIcon1 | string | Item icon filename |
| 6 | InventoryIcon2 | string | Secondary icon (rarely used) |
| 7 | GeosetGroup1 | int | Geoset group value 1 |
| 8 | GeosetGroup2 | int | Geoset group value 2 |
| 9 | GeosetGroup3 | int | Geoset group value 3 |
| 10 | Flags | int | Display flags |
| 11 | SpellVisualID | int | Enchant/proc visual effect |
| 12 | GroupSoundIndex | int | Sound group |
| 13 | HelmetGeosetVis1 | int | Helmet geoset hide data (male) |
| 14 | HelmetGeosetVis2 | int | Helmet geoset hide data (female) |
| 15-22 | Texture1-8 | string | Body region textures (ArmUpper through Foot) |
| 23 | ItemVisual | int | Weapon glow/trail visual effect |

### Full Resolution Example: Chest Armor

```
itemId: 16922 (Breastplate of Might)
  |
  v
item_template SQL -> displayId: 28516
  |
  v
ItemDisplayInfo.dbc[28516]:
  ModelName1: ""                               (no separate 3D model)
  GeosetGroup1: 1                              (short sleeves)
  Texture1: "Chest_Plate_RaidWarrior_A_01"     (ArmUpper)
  Texture2: ""                                 (ArmLower)
  Texture3: ""                                 (Hand)
  Texture4: "Chest_Plate_RaidWarrior_A_01"     (TorsoUpper)
  Texture5: ""                                 (TorsoLower)
  Texture6: ""                                 (LegUpper)
  Texture7: ""                                 (LegLower)
  Texture8: ""                                 (Foot)
  |
  v
Runtime:
  - Enable geoset 802 (short sleeves)
  - Load: Item\TextureComponents\ArmUpperTexture\Chest_Plate_RaidWarrior_A_01.blp
  - Load: Item\TextureComponents\TorsoUpperTexture\Chest_Plate_RaidWarrior_A_01.blp
  - Composite onto character body texture at ArmUpper and TorsoUpper regions
```

### Full Resolution Example: Weapon

```
itemId: 19019 (Thunderfury)
  |
  v
item_template SQL -> displayId: 20190
  |
  v
ItemDisplayInfo.dbc[20190]:
  ModelName1: "Sword_2H_Claymore_C_01.mdx"
  ModelTexture1: "Sword_1H_Long_D_01_V01"
  GeosetGroup1-3: 0                            (no geoset changes)
  Texture1-8: ""                               (no body textures)
  ItemVisual: (enchant glow ID)
  |
  v
Runtime:
  - Load: Item\ObjectComponents\Weapon\Sword_2H_Claymore_C_01.m2
  - Apply: Item\ObjectComponents\Weapon\Sword_1H_Long_D_01_V01.blp
  - Attach to character HandRight attachment point (bone #1)
```

---

## CharSections.dbc -- Character Customization

Maps race/gender/section type to texture filenames.

| Column | Field | Description |
|--------|-------|-------------|
| 0 | ID | Primary key |
| 1 | Race | Race ID |
| 2 | Gender | 0=Male, 1=Female |
| 3 | SectionType | 0=Skin, 1=Face, 2=FacialHair, 3=Hair, 4=Underwear |
| 4-6 | Texture1-3 | Texture filenames |
| 7 | Flags | Display flags |
| 8 | VariationIndex | Skin color / face / hair style number |
| 9 | ColorIndex | Color variant |

**Usage for character rendering**:
- Type 0 (Skin): Base body texture per race/gender/skin color
- Type 1 (Face): Face texture overlay
- Type 3 (Hair): Scalp texture for body texture + 3D hair model texture
- Type 4 (Underwear): Underwear texture layer

---

## HelmetGeosetVisData.dbc

| Column | Field | Description |
|--------|-------|-------------|
| 0 | ID | Referenced by ItemDisplayInfo.HelmetGeosetVis |
| 1 | HideHair | 0=show, 1=hide |
| 2 | HideFacialHair1 | 0=show, 1=hide |
| 3 | HideFacialHair2 | 0=show, 1=hide |
| 4 | HideFacialHair3 | 0=show, 1=hide |
| 5 | HideEars | 0=show, 1=hide |

---

## ChrRaces.dbc

| Column | Field | Description |
|--------|-------|-------------|
| 0 | ID | Race ID (1=Human, 2=Orc, ...) |
| 6 | MaleModel | Male model file reference |
| 7 | FemaleModel | Female model file reference |
| 14 | ClientPrefix | Internal code (Hu, Or, Dw, NE, Sc, Ta, Gn, Tr) |
| 20 | Name | Localized race name |

---

## AnimationData.dbc

| Column | Field | Description |
|--------|-------|-------------|
| 0 | ID | Animation ID (0=Stand, 4=Walk, etc.) |
| 1 | Name | Animation name string |
| 4 | Flags | Animation flags |
| 5 | Fallback | Fallback animation ID if this one is missing |

---

## DBC Binary Format

All DBC files share the same simple binary structure:

```c
struct DBCHeader {
    char     magic[4];           // "WDBC"
    uint32_t recordCount;        // Number of rows
    uint32_t fieldCount;         // Number of columns
    uint32_t recordSize;         // Bytes per record
    uint32_t stringBlockSize;    // Size of string block at end
};
// Followed by: recordCount * recordSize bytes of record data
// Followed by: stringBlockSize bytes of null-terminated strings
```

Fields are fixed-size (4 bytes each: int32 or string offset). String fields store a byte offset into the string block at the end of the file.

### Parsing in TypeScript

```typescript
interface DBCFile {
  recordCount: number;
  fieldCount: number;
  records: ArrayBuffer;    // Raw record data
  strings: string;         // Decoded string block
}

function parseDBCFile(buffer: ArrayBuffer): DBCFile {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== 'WDBC') throw new Error('Not a DBC file');

  const recordCount = view.getUint32(4, true);
  const fieldCount = view.getUint32(8, true);
  const recordSize = view.getUint32(12, true);
  const stringBlockSize = view.getUint32(16, true);

  const dataStart = 20;
  const stringStart = dataStart + (recordCount * recordSize);

  return {
    recordCount,
    fieldCount,
    records: buffer.slice(dataStart, stringStart),
    strings: new TextDecoder().decode(new Uint8Array(buffer, stringStart, stringBlockSize)),
  };
}

function getInt(dbc: DBCFile, record: number, field: number): number {
  const view = new DataView(dbc.records);
  const recordSize = dbc.records.byteLength / dbc.recordCount;
  return view.getInt32(record * recordSize + field * 4, true);
}

function getString(dbc: DBCFile, record: number, field: number): string {
  const offset = getInt(dbc, record, field);
  const end = dbc.strings.indexOf('\0', offset);
  return dbc.strings.substring(offset, end);
}
```

---

## Pre-Processed JSON Metadata Structure

### display-id-lookup.json (~200KB, easily cacheable)

```json
{
  "647": 20190,
  "19019": 19023,
  "16922": 28516
}
```

### meta/item/{displayId}.json (~1KB each, or batched)

```json
{
  "id": 20190,
  "model": "Sword_2H_Claymore_C_01",
  "modelTexture": "Sword_1H_Long_D_01_V01",
  "icon": "INV_Sword_19",
  "geosetGroup": [0, 0, 0],
  "helmetGeosetVis": [0, 0],
  "bodyTextures": {
    "armUpper": "",
    "armLower": "",
    "hand": "",
    "torsoUpper": "",
    "torsoLower": "",
    "legUpper": "",
    "legLower": "",
    "foot": ""
  },
  "itemVisual": 0
}
```

### Batching Strategy

Rather than 24,000 individual files, batch by ID range:
- `item-display-info/batch-0.json` (displayIds 0-999)
- `item-display-info/batch-1.json` (displayIds 1000-1999)
- ~30 files of ~800 entries each, ~50-100KB per file

---

## Data Pipeline Build Script

```typescript
// scripts/build-data-pipeline.ts

// Step 1: Parse item_template SQL for itemId -> displayId
const itemDisplayMap = parseSQLDump('data/item_template.sql');

// Step 2: Parse ItemDisplayInfo.dbc (or use Turtle-WOW-DBC JSON)
const displayInfo = JSON.parse(fs.readFileSync('data/ItemDisplayInfo.json'));

// Step 3: Parse CharSections.dbc
const charSections = parseDBC('extracted/DBFilesClient/CharSections.dbc');

// Step 4: Parse HelmetGeosetVisData.dbc
const helmetGeosets = parseDBC('extracted/DBFilesClient/HelmetGeosetVisData.dbc');

// Step 5: Generate output files
writeJSON('assets/data/display-id-lookup.json', itemDisplayMap);
writeJSON('assets/data/char-sections.json', formatCharSections(charSections));
writeJSON('assets/data/helmet-geoset-vis.json', formatHelmetGeosets(helmetGeosets));

// Step 6: Generate batched ItemDisplayInfo
for (const batch of chunk(displayInfo, 1000)) {
  writeJSON(`assets/data/item-display-info/batch-${batch.id}.json`, batch);
}
```

---

## Missing Data: Turtle WoW Custom Items

~1,550 items (IDs 40,000+) are Turtle WoW custom additions. Their `itemId -> displayId` mapping requires either:

1. **Turtle WoW server database access** (if available)
2. **Manual extraction** from the Turtle WoW client's item cache
3. **Community data** from the Turtle WoW database website (database.turtle-wow.org)

~90% of custom items reuse vanilla display IDs (same visual as existing items). The remaining ~10% use truly custom models that exist only in Turtle WoW's patch MPQ files.

# CLAUDE.md — WoW Model Viewer

## Project Goal

Self-hosted web-based WoW character model viewer rendering from local Turtle WoW (1.12.x) game files. Independent of Wowhead/zamimg. Built with Three.js + @wowserhq/format.

## Data Files — READ THIS FIRST

### NEVER Read Binary Files Directly

Files with extensions `.m2`, `.blp`, `.skin`, `.dbc`, `.wmo`, `.mpq` are **binary**. Using the `Read` tool on them produces garbage that wastes context.

Instead:
- **Check size/existence**: `ls -lh <path>`
- **Inspect headers**: `xxd -l 64 <path>` or `hexdump -C -n 64 <path>`
- **Parse structure**: Write/use Node.js scripts with `@wowserhq/format`
- **Count files**: `find <dir> -name "*.m2" | wc -l` (never list full contents)

### JSON DBC Files — Size Tiers

The `data/dbc/` directory has pre-converted DBC JSON files. Every file has 14 lines of tool log output before the actual JSON array on line 15.

**SAFE to read in full (< 50KB):**
| File | Size |
|------|------|
| `HelmetGeosetVisData.json` | 2.9K |
| `ItemClass.json` | 3.0K |
| `ItemVisuals.json` | 3.2K |
| `ItemVisualEffects.json` | 3.4K |
| `ChrRaces.json` | 17K |
| `ItemSubClass.json` | 22K |
| `AnimationData.json` | 26K |

**USE jq — NEVER read in full:**
| File | Size | Why |
|------|------|-----|
| `CharSections.json` | 863K | ~4,000 records |
| `CreatureModelData.json` | 359K | ~2,000 records |
| `CreatureDisplayInfo.json` | 6.3M | ~18,000 records |
| `ItemDisplayInfo.json` | 18M | ~24,000 records |

To query large JSON files, extract the array from line 15 and pipe through jq:
```bash
# Get record count
sed -n '15p' data/dbc/ItemDisplayInfo.json | jq 'length'

# Find a specific record by ID
sed -n '15p' data/dbc/ItemDisplayInfo.json | jq '.[] | select(.ID == 20190)'

# Sample first 3 records (inspect schema)
sed -n '15p' data/dbc/ItemDisplayInfo.json | jq '.[0:3]'

# Search by field value
sed -n '15p' data/dbc/ItemDisplayInfo.json | jq '[.[] | select(.ModelName1 != "")] | length'
```

### Extracted Patch Files (`data/patch/`)

Contains ~39K BLP, ~6.5K M2, ~530 DBC files across patch-2 through patch-9 + patch-y directories.

**Rules:**
- NEVER glob or list entire `data/patch/` — it will flood context
- Use specific subdirectory paths: `ls data/patch/patch-3/Character/BloodElf/Male/`
- Use `find ... | wc -l` for counts
- Use `find ... | head -20` for sampling
- Character models are in `data/patch/patch*/Character/<Race>/<Gender>/`
- Item models are in `data/patch/patch*/Item/ObjectComponents/<Type>/`

**What's missing:** Base MPQ archives (model.MPQ, texture.MPQ, misc.MPQ) were not extracted. Most .skin files and base item/character textures are absent. Only patch overrides are present.

## Development Workflow

### Strict Phase Gates

Work proceeds in numbered phases. **You cannot start Phase N+1 until Phase N output is verified.** No exceptions.

Each phase follows this cycle:
1. **Plan** — State what we're building and the expected output
2. **Build** — Write the minimal code to achieve it
3. **Verify** — Run scripts that print summary stats + run automated tests
4. **Record** — Append findings to `docs/LEARNINGS.md`
5. **Gate check** — Review output with user before proceeding

### Phase Structure

Each phase deliverable must include:
- A **script** that produces output (file, console summary, or both)
- A **test file** (vitest) that asserts expected outputs
- A **learnings entry** documenting what we discovered

### Iteration Rules

- Start small. One race, one item, one file — not all 14,000.
- Get something visible and testable before scaling up.
- When something doesn't match expectations, investigate and record the finding before moving on.
- Don't build abstractions until you have 3+ concrete examples working.

## Testing

### Dual Verification

Every phase has both:

1. **Script output checks** — Each script prints summary stats to stdout:
   - Record counts, field names, sample values
   - File sizes before/after conversion
   - Error counts and specific failures

2. **Automated tests** (vitest) — Assert:
   - Expected record counts
   - Known-good reference values (e.g., Thunderfury displayId = 20190)
   - File format correctness (magic bytes, field types)
   - Edge cases from learnings

### Visual Testing (later phases)

Playwright + Claude Vision for screenshot-based evaluation of rendered output. See `docs/TESTING-STRAT.md` for the full approach.

## Learnings Journal

All discoveries go in `docs/LEARNINGS.md`. Format:

```markdown
## [YYYY-MM-DD] Topic

**Context:** What we were doing
**Finding:** What we discovered
**Impact:** How this affects our approach
**Reference:** File path, line number, or command that revealed this
```

Examples of things to record:
- DBC field meanings that differ from documentation
- File path conventions that don't match expected patterns
- Binary format quirks specific to Turtle WoW patches
- Race/gender suffixes that differ from vanilla
- Missing or unexpected data

## Key Reference

### Research Docs
- `docs/research/00-overview.md` — Project goals, tech stack
- `docs/research/01-file-extraction-guide.md` — File paths, MPQ structure
- `docs/research/02-m2-format-deep-dive.md` — M2 binary format spec
- `docs/research/03-character-rendering-pipeline.md` — Geosets, textures, attachment
- `docs/research/04-open-source-libraries.md` — Library evaluation
- `docs/research/05-asset-cdn-architecture.md` — Asset serving strategy
- `docs/research/06-dbc-data-pipeline.md` — DBC schemas, data chain
- `docs/research/07-implementation-roadmap.md` — Phased plan
- `docs/research/08-required-wow-files.md` — Complete file inventory

### Data Locations
| What | Where |
|------|-------|
| DBC JSON (pre-converted) | `data/dbc/*.json` |
| Patch extractions (binary) | `data/patch/patch-*/` |
| Character models | `data/patch/patch*/Character/<Race>/<Gender>/` |
| Item models | `data/patch/patch*/Item/ObjectComponents/<Type>/` |
| Textures | `data/patch/patch*/**/*.blp` |

### External Data Needed (not yet acquired)
| Source | Purpose |
|--------|---------|
| `thatsmybis/classic-wow-item-db` | SQL: itemId -> displayId mapping |

### Tech Stack
| Tool | Purpose |
|------|---------|
| Three.js | WebGL rendering |
| `@wowserhq/format` | M2, BLP, DBC, SKIN parsing |
| `@wowserhq/stormjs` | MPQ extraction (if needed) |
| vitest | Unit/integration tests |
| Playwright + Claude Vision | Visual regression tests |

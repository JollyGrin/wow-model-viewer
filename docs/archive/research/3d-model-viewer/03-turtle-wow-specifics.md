# Turtle WoW: Custom Models, Races & Data Sources

## Overview

Turtle WoW runs the "Mysteries of Azeroth" expansion on a **1.12.1/1.12.2 client** with custom MPQ patches. It adds substantial horizontal content while maintaining the level 60 cap.

## Custom Content Inventory

- **2 new playable races**: High Elves (Alliance), Goblins (Horde)
- **New class combinations**: Orc/Dwarf Mage, Undead/Gnome Hunter, etc.
- **New zones**: Gilneas, Karazhan Crypt, Tel'Abim
- **New dungeons**: Gilneas City (43-49), Karazhan Crypt (58-60), expanded SFK/SM/WC/DM
- **New professions**: Survival, Jewelcrafting
- **Transmogrification system**
- **Extensive custom items**: Armor sets, weapons, crafting recipes, PvP gear

## How Custom Items Work

### Two Categories

**Category A -- Reused Vanilla Display IDs (~90%+ of items)**:
New item entries in `item_template` with different stats/names but pointing to existing vanilla `displayID`. These are trivial to render -- any vanilla model viewer can handle them.

Examples:
- Hateforge Armor (blacksmithing mail) -- existing mail model appearances
- Bloody Gladiator sets -- existing visual appearances
- Most quest rewards, dungeon drops, profession crafts

**Category B -- Custom Display IDs (~10% of items)**:
Items with display IDs that don't exist in vanilla. Sub-categories:
- **Recolored textures**: Same M2 model, different BLP texture. Example: Tier 2 recolors for Druid/Paladin/Warrior
- **Backported models**: Models from TBC/WotLK/Cata converted to vanilla M2 format. Example: 20th Anniversary Tier 2 sets, "Might of Menethil," "Corrupted Ashbringer"
- **Community-created models**: Built in Blender + WoW Blender Studio. Rare but exist

### Item ID Ranges in Our Data

| Range | Count | Description |
|-------|-------|-------------|
| 647 - ~24,000 | ~8,600 | Standard vanilla items (Wowhead has model data) |
| 24,000 - 40,000 | ~800 | TBC-era / extended vanilla IDs |
| 40,000+ | ~590 | Likely Turtle WoW custom items |
| 50,000+ | ~10 | Highest custom items (up to 52,572) |

## Custom Races

### High Elves
- **Base model**: TBC Blood Elf backported to 1.12 M2 format
- **Conversion path**: Retail Blood Elf -> WotLK M2 -> Vanilla M2
- **Visual differences from Blood Elf**: Blue eyes (vs green), unique customization options
- **Model viewer implication**: Could source Blood Elf models from TBC/WotLK data as approximation, or extract from Turtle WoW MPQ patches for exact match

### Goblins
- **Base model**: Cataclysm Goblin reskinned to look like classic NPC goblins
- **Customization**: 5 custom faces per gender, unique haircuts
- **Fixes applied**: 30+ helmet visual fixes, casting animation fixes, weapon sheathing fixes
- **Model viewer implication**: Need Cataclysm-era Goblin data, or extract from Turtle WoW

## Data Sources

### Official Database
- **URL**: https://database.turtle-wow.org/
- Based on AoWoW (open-source WoW database)
- Has items, NPCs, quests with tooltips
- **No public API** -- behind Cloudflare, no documented REST endpoints
- Limited search (max 500 results, no filters)

### Official Armory
- **URL**: https://turtle-wow.org/armory
- **Status**: Largely broken/abandoned as of 2025
- Had a 3D character view feature (also broken)
- No confirmed public API

### Critical GitHub Resources

| Resource | URL | Contents |
|----------|-----|----------|
| **Turtle-WOW-DBC** | [github.com/oplancelot/Turtle-WOW-DBC](https://github.com/oplancelot/Turtle-WOW-DBC) | 261 DBC files exported from Turtle WoW, including ItemDisplayInfo.dbc as JSON |
| TurtleHD | [github.com/redmagejoe/TurtleHD](https://github.com/redmagejoe/TurtleHD) | HD patch MPQ files |
| pfQuest-turtle | [github.com/shagu/pfQuest-turtle](https://github.com/shagu/pfQuest-turtle) | TurtleWoW DB extension |
| RetroCro/TurtleWoW-Mods | [github.com/RetroCro/TurtleWoW-Mods](https://github.com/RetroCro/TurtleWoW-Mods) | Client fixes and mods |

### Dev Tools
- **dev.turtle-wow.org**: Database Utils tool by Xerron -- item/quest SQL generator compatible with VMaNGOS
- **Turtle WoW Wiki**: https://turtle-wow.fandom.com/wiki/ -- extensive community documentation

## MPQ Patch System

Turtle WoW distributes custom assets via MPQ patches:
- Located in `TurtleWoW/Data/` folder
- Named `patch-1.mpq` through `patch-Z.mpq`
- Loaded sequentially (later patches override earlier)
- Community HD mods use late-alphabet names (e.g., `patch-P.MPQ`)
- Managed automatically by the Turtle WoW launcher

### Extracting Custom Assets
Tools:
- **Ladik's MPQ Editor**: Open/extract MPQ archives
- **WDBX Editor**: Convert DBC files to JSON/CSV
- **wow.export**: Supports legacy MPQ installations for extraction

## Handling Strategy for Model Viewer

### Tier 1 -- Vanilla Display IDs (Easy, ~90%+ coverage)
Use vanilla model data (from Wowhead CDN or extracted). Map Turtle WoW item -> displayId -> vanilla model.

### Tier 2 -- Retextured Vanilla Models (Moderate)
Same M2 model, different BLP texture. Would need to extract custom textures from Turtle WoW MPQ and host them.

### Tier 3 -- Backported/Custom Models (Hard)
New M2 files. Extract from Turtle WoW MPQ, convert to web format, host ourselves.

### Tier 4 -- Custom Race Models (Hardest)
Full character models with rigging/animation. Need complete backported model files. Alternative: source Blood Elf/Goblin models from TBC/Cata data (not pixel-identical).

### Practical Recommendation
1. Start with vanilla display IDs only (covers majority)
2. Use Turtle-WOW-DBC repo to get ItemDisplayInfo.dbc, diff against vanilla to identify custom display IDs
3. Show fallback (item icon, tooltip, or "custom model" placeholder) for custom items
4. Extract custom assets later if needed

## Sources
- [Turtle WoW Official](https://turtlecraft.gg)
- [Turtle WoW Wiki](https://turtle-wow.fandom.com/wiki/)
- [Turtle WoW Forum - Custom Models](https://forum.turtle-wow.org/viewtopic.php?t=20599)
- [CLASSIIC HD Patch Thread](https://forum.turtle-wow.org/viewtopic.php?t=16720)
- [Importing Custom Models Guide](https://forum.turtle-wow.org/viewtopic.php?t=9360)
- [Turtle-WOW-DBC GitHub](https://github.com/oplancelot/Turtle-WOW-DBC)

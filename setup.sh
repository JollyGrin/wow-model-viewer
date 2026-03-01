#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}WoW Model Viewer — Setup${NC}"
echo "========================"
echo ""

# ── Step 1: Check prerequisites ──────────────────────────────────────────────

echo -e "${BOLD}[1/5] Checking prerequisites...${NC}"

if ! command -v bun &>/dev/null; then
  echo -e "${RED}ERROR: bun is not installed.${NC}"
  echo "  Install it: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} bun $(bun --version)"

if ! command -v node &>/dev/null; then
  echo -e "${RED}ERROR: node is not installed.${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} node $(node --version)"

# ── Step 2: Install dependencies ─────────────────────────────────────────────

echo ""
echo -e "${BOLD}[2/5] Installing dependencies...${NC}"
bun install
echo -e "  ${GREEN}✓${NC} Dependencies installed"

# ── Step 3: Check data files ─────────────────────────────────────────────────

echo ""
echo -e "${BOLD}[3/5] Checking data files...${NC}"

MISSING_M2=0
MISSING_BLP=0

# M2 model files (required)
M2_FILES=(
  "data/patch/patch-6/Character/BloodElf/Male/BloodElfMale.M2"
  "data/patch/patch-6/Character/BloodElf/Female/BloodElfFemale.M2"
  "data/patch/patch-6/Character/Dwarf/Male/DwarfMale.M2"
  "data/patch/patch-6/Character/Dwarf/Female/DwarfFemale.M2"
  "data/patch/patch-6/Character/Gnome/Male/GnomeMale.M2"
  "data/patch/patch-6/Character/Gnome/Female/GnomeFemale.M2"
  "data/patch/patch-7/Character/Goblin/Male/GoblinMale.m2"
  "data/patch/patch-7/Character/Goblin/Female/GoblinFemale.m2"
  "data/patch/patch-6/Character/Human/Male/HumanMale.m2"
  "data/patch/patch-6/Character/Human/Female/HumanFemale.M2"
  "data/patch/patch-6/Character/NightElf/Male/NightElfMale.M2"
  "data/patch/patch-6/Character/NightElf/Female/NightElfFemale.M2"
  "data/patch/patch-6/Character/Orc/Male/OrcMale.M2"
  "data/patch/patch-6/Character/Orc/Female/OrcFemale.M2"
  "data/patch/patch-6/Character/Scourge/Male/ScourgeMale.M2"
  "data/patch/patch-6/Character/Scourge/Female/ScourgeFemale.M2"
  "data/patch/patch-6/Character/Tauren/Male/TaurenMale.M2"
  "data/patch/patch-6/Character/Tauren/Female/TaurenFemale.M2"
  "data/patch/patch-6/Character/Troll/Male/TrollMale.M2"
  "data/patch/patch-6/Character/Troll/Female/TrollFemale.M2"
)

# Skin texture files (required)
BLP_FILES=(
  "data/patch/patch-5/Character/BloodElf/Male/BloodElfMaleSkin00_10.blp"
  "data/patch/patch-5/Character/BloodElf/Female/BloodElfFemaleSkin00_10.blp"
  "data/patch/patch-5/Character/Dwarf/Male/DwarfMaleSkin00_09.blp"
  "data/patch/patch-5/Character/Dwarf/Female/DwarfFemaleSkin00_09.blp"
  "data/patch/patch-5/Character/Gnome/Male/GnomeMaleSkin00_05.blp"
  "data/patch/patch-5/Character/Gnome/Female/GnomeFemaleSkin00_05.blp"
  "data/patch/patch-8/Character/Human/Male/HumanMaleSkin00_101.blp"
  "data/patch/patch-3/Character/Human/Female/HumanFemaleSkin00_102.blp"
  "data/patch/patch-5/Character/NightElf/Male/NightElfMaleSkin00_09.blp"
  "data/patch/patch-5/Character/NightElf/Female/NightElfFemaleSkin00_10.blp"
  "data/patch/patch-3/Character/Orc/Male/OrcMaleSkin00_106.blp"
  "data/patch/patch-8/Character/Orc/Female/OrcFemaleSkin00_100.blp"
  "data/patch/patch-5/Character/Scourge/Male/DeathKnightMaleSkin00_00.blp"
  "data/patch/patch-5/Character/Scourge/Female/ScourgeBloodWidowSkin00_00.blp"
  "data/patch/patch-5/Character/Tauren/Male/TaurenMaleSkin00_20.blp"
  "data/patch/patch-8/Character/Tauren/Female/TaurenFemaleSkin00_19.blp"
  "data/patch/patch-3/Character/Troll/Male/TrollMaleSkin00_109.blp"
  "data/patch/patch-5/Character/Troll/Female/ForestTrollFemaleSkin00_05.blp"
  "data/patch/patch-6/Character/Human/Hair04_07.blp"
)

for f in "${M2_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo -e "  ${RED}✗${NC} MISSING: $f"
    MISSING_M2=$((MISSING_M2 + 1))
  fi
done

for f in "${BLP_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo -e "  ${RED}✗${NC} MISSING: $f"
    MISSING_BLP=$((MISSING_BLP + 1))
  fi
done

if [ "$MISSING_M2" -gt 0 ]; then
  echo ""
  echo -e "${RED}ERROR: $MISSING_M2 M2 model file(s) missing.${NC}"
  echo "  Copy your Turtle WoW patch files into data/patch/"
  echo "  Expected structure: data/patch/patch-{2..9,y}/Character/<Race>/<Gender>/"
  exit 1
fi

if [ "$MISSING_BLP" -gt 0 ]; then
  echo ""
  echo -e "${RED}ERROR: $MISSING_BLP BLP texture file(s) missing.${NC}"
  echo "  Copy your Turtle WoW patch files into data/patch/"
  exit 1
fi

echo -e "  ${GREEN}✓${NC} All 20 M2 model files found"
echo -e "  ${GREEN}✓${NC} All 19 BLP texture files found"

# ── Step 4: Convert assets ───────────────────────────────────────────────────

echo ""
echo -e "${BOLD}[4/5] Converting models (M2 → web format)...${NC}"
bun run scripts/convert-model.ts
echo ""

echo -e "${BOLD}[4/5] Converting textures (BLP → web format)...${NC}"
bun run scripts/convert-textures.ts
echo ""

MODELS_COUNT=$(find public/models -name "model.json" | wc -l | tr -d ' ')
TEXTURES_COUNT=$(find public/models -name "skin.tex" | wc -l | tr -d ' ')
echo -e "  ${GREEN}✓${NC} $MODELS_COUNT models converted"
echo -e "  ${GREEN}✓${NC} $TEXTURES_COUNT textures converted"

# ── Step 5: Start dev server ─────────────────────────────────────────────────

echo ""
echo -e "${BOLD}[5/5] Starting dev server...${NC}"

# Kill anything on port 5173
if lsof -ti:5173 &>/dev/null; then
  echo "  Killing existing process on port 5173..."
  lsof -ti:5173 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

echo ""
echo -e "${GREEN}${BOLD}Ready! Opening http://localhost:5173/${NC}"
echo "  Use the dropdowns to switch race/gender."
echo "  Press Ctrl+C to stop the server."
echo ""

exec bun run dev

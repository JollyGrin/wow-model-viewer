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

echo -e "${BOLD}[1/3] Checking prerequisites...${NC}"

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
echo -e "${BOLD}[2/3] Installing dependencies...${NC}"
bun install
echo -e "  ${GREEN}✓${NC} Dependencies installed"

# ── Step 3: Check data files ─────────────────────────────────────────────────

echo ""
echo -e "${BOLD}[3/3] Checking required data...${NC}"

MISSING=0

# MPQ archives (required for item extraction)
for f in data/model/model.MPQ data/model/texture.MPQ data/model/patch.MPQ; do
  if [ ! -f "$f" ]; then
    echo -e "  ${RED}✗${NC} MISSING: $f"
    MISSING=$((MISSING + 1))
  fi
done

# DBC files
for f in data/dbc/ItemDisplayInfo.json data/dbc/CharSections.json data/dbc/ChrRaces.json; do
  if [ ! -f "$f" ]; then
    echo -e "  ${RED}✗${NC} MISSING: $f"
    MISSING=$((MISSING + 1))
  fi
done

# Spot-check character M2s
if [ ! -f "data/patch/patch-6/Character/Human/Male/HumanMale.m2" ]; then
  echo -e "  ${RED}✗${NC} MISSING: Character M2 files (patch-6)"
  MISSING=$((MISSING + 1))
fi

if [ "$MISSING" -gt 0 ]; then
  echo ""
  echo -e "${RED}Missing data files.${NC}"
  echo ""
  echo "  Option A — Extract from TurtleWoW client automatically:"
  echo "    bun run scripts/setup-from-client.ts /path/to/TurtleWoW"
  echo ""
  echo "  Option B — Copy files manually:"
  echo "    1. Copy model.MPQ, texture.MPQ, patch.MPQ → data/model/"
  echo "    2. Extract patch-2 through patch-9, patch-y → data/patch/"
  echo "    3. Convert DBC files → data/dbc/"
  echo ""
  echo "  Then re-run this script."
  exit 1
fi

echo -e "  ${GREEN}✓${NC} MPQ archives found"
echo -e "  ${GREEN}✓${NC} DBC data found"
echo -e "  ${GREEN}✓${NC} Patch data found"

# ── Build all assets ─────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Building all assets...${NC}"
echo "  This converts character models, textures, items, and builds the catalog."
echo ""

bun run scripts/build-assets.ts

echo ""
echo -e "${GREEN}${BOLD}Ready!${NC}"
echo "  Start the viewer:  bun run dev"
echo "  Then open:         http://localhost:5173/"
echo ""

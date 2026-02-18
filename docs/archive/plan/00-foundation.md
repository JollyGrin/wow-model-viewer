# Phase 0: Foundation

## Overview

Set up the project scaffolding with Next.js 15+, TypeScript strict mode, Tailwind v4, shadcn/ui, and testing frameworks (Vitest + Playwright).

## Goals

1. Working dev environment with hot reload
2. TypeScript strict mode enforced
3. shadcn/ui components available
4. Unit testing with Vitest
5. E2E testing with Playwright
6. Project documentation (CLAUDE.md, LEARNINGS.md, SKILLS.md)

## Technical Decisions

### Next.js 16 (latest)
- Using App Router
- React 19 for latest features
- Server Components by default

### TypeScript Strict Mode
- Already enabled in tsconfig.json
- Catches type errors early
- Better IDE support

### Tailwind v4
- Already configured with PostCSS
- CSS-first configuration
- Faster builds

### shadcn/ui
- Copy-paste component library
- Full customization control
- Works with Tailwind v4

### Vitest
- Fast unit testing
- Native ESM support
- Compatible with React Testing Library

### Playwright
- Cross-browser E2E testing
- Auto-wait for elements
- Great debugging tools

## File Structure After Phase 0

```
gear-journey/
├── app/
│   ├── components/
│   │   ├── ui/           # shadcn/ui components
│   │   ├── items/        # Items tab components (Phase 2)
│   │   └── progression/  # Timeline components (Phase 3)
│   ├── lib/              # Utilities (Phase 1+)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── docs/
│   ├── plan/
│   │   └── 00-foundation.md
│   └── inspiration/
├── public/
│   └── data/             # JSON data files (Phase 1)
├── tests/
│   ├── unit/
│   └── e2e/
├── CLAUDE.md
├── LEARNINGS.md
├── SKILLS.md
└── package.json
```

## Verification

- [ ] `bun dev` starts server without errors
- [ ] TypeScript compilation has no errors
- [ ] `bun test` runs Vitest tests
- [ ] `bun test:e2e` runs Playwright tests
- [ ] shadcn/ui Button component renders correctly

## Notes

- Using bun as package manager (faster than npm/pnpm)
- Next.js 16 is the latest version (plan mentioned 15, upgrading)
- React 19 is already installed

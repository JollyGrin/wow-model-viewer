# Open Questions & Unknowns

## Critical Questions (Must Answer Before Coding)

### 1. Display ID Data Source
**Question**: Does the Turtle-WOW-DBC repo actually contain Item.dbc with the itemId -> displayId mapping, or only ItemDisplayInfo.dbc?
**Why it matters**: We need the mapping FROM our item IDs TO display IDs. ItemDisplayInfo.dbc maps display IDs to visuals, but we need Item.dbc (or item_template) to map item IDs to display IDs.
**Action**: Download and inspect the Turtle-WOW-DBC repo.

### 2. Wowhead Classic CDN Coverage
**Question**: Does Wowhead's classic CDN have model data for ALL vanilla items, or only a subset?
**Why it matters**: If Wowhead is missing models for some vanilla items, our coverage estimate of 86% could be wrong.
**Action**: Test a few item display IDs from different categories (weapons, armor, low-level, high-level) against the CDN.

### 3. wow-model-viewer Package Current State
**Question**: Is wow-model-viewer v1.5.2 still working with Wowhead's current CDN? When was it last tested?
**Why it matters**: The package depends on the minified ZamModelViewer which Wowhead can change at any time.
**Action**: `npm install wow-model-viewer` and test with a basic character + item before committing to this approach.

### 4. CORS Proxy Viability in Production
**Question**: Can a Next.js API route handle proxying model assets at scale? What's the latency impact?
**Why it matters**: Model data includes binary files (geometry, textures). Each character load could trigger 10-30 asset requests through the proxy.
**Action**: Prototype the proxy, measure latency, consider caching strategy (Vercel edge caching?).

## Important Questions (Should Answer During Development)

### 5. Slot Normalization for Viewer
**Question**: How do we handle One-Hand vs Main Hand vs Off Hand for the viewer?
**Context**: Our app normalizes `One-Hand` to `Main Hand` or `Off Hand`. The viewer needs explicit slot IDs (16 for main hand, 17 for off hand).
**Action**: Review how the progression list assigns items to specific hand slots.

### 6. Non-Visible Equipment Slots
**Question**: Should we attempt to display rings, trinkets, necklaces in the viewer?
**Context**: These have no visual model. Wowhead's dressing room shows them in a sidebar with icons only.
**Action**: Design decision -- likely show as icons in the gear panel, not in 3D.

### 7. Character Race/Gender Selection
**Question**: How does the user pick their character's race and gender?
**Context**: Gear looks different on different races (proportions, textures). Need a selector.
**Action**: Design a race/gender picker component. Start with a default (Human Male?).

### 8. WebGL Context Limits
**Question**: Can we safely have the viewer on a tab without it interfering with the rest of the app?
**Context**: WebGL contexts are limited resources. Multiple instances can cause crashes.
**Action**: Only mount the viewer when the 3D tab is active. Destroy on tab switch.

### 9. Mobile Support
**Question**: Should the 3D viewer work on mobile, or desktop-only?
**Context**: WebGL rendering is heavy. Mobile browsers have stricter memory limits.
**Action**: Consider showing a static fallback (item icons/renders) on mobile.

## Turtle WoW Specific Questions

### 10. Custom Item Display ID Coverage
**Question**: What percentage of our ~590 high-ID items (40,000+) actually have custom display IDs vs reusing vanilla ones?
**Action**: Cross-reference our items.json high-ID items against the Turtle-WOW-DBC to check.

### 11. High Elf / Goblin Viewer Support
**Question**: If a user selects High Elf or Goblin race, can the Wowhead viewer render them?
**Context**: Wowhead has Blood Elf (TBC) and Goblin (Cata) models. These may not be available via the "classic" CDN path.
**Action**: Test with race IDs 10 (Blood Elf) and 9 (Goblin) via the Wowhead viewer.

### 12. Ashbringer Extra Effects
**Question**: Item "Ashbringer (Extra Effects)" at ID 52,572 -- what visual does this use?
**Context**: This is the highest ID in our data. It's clearly a custom Turtle WoW item.
**Action**: Check the Turtle-WOW-DBC for this item's display ID.

## Technical Risks

### Risk 1: Wowhead Viewer Breakage
**Probability**: Medium (happens periodically)
**Impact**: Complete viewer failure until we update our wrapper
**Mitigation**: Pin to a known-working version of viewer.min.js, cache locally

### Risk 2: CDN Rate Limiting
**Probability**: Low-Medium
**Impact**: Slow/failed asset loads
**Mitigation**: Aggressive client-side caching, lazy loading, proxy caching

### Risk 3: jQuery Conflicts
**Probability**: Low (React + jQuery can coexist but it's ugly)
**Impact**: Subtle DOM manipulation bugs
**Mitigation**: Load jQuery in an isolated scope, dynamic import only when viewer is mounted

### Risk 4: Memory Leaks
**Probability**: Medium (WebGL contexts are leak-prone)
**Impact**: Tab crashes on extended use, especially when scrubbing levels
**Mitigation**: Proper cleanup on unmount, reuse single viewer instance, update items without recreating

## Questions We Haven't Asked Yet

### 13. Enchant Visual Effects
Should the viewer show weapon enchant glows? This requires additional data (enchantId) we don't currently have.

### 14. Set Bonus Visual
Some tier sets have special visual effects. Do we want to show these?

### 15. Caching Strategy
How do we cache model assets? Service Worker? Local Storage? IndexedDB? The model data for one character outfit could be several MB.

### 16. Accessibility
How do we make the 3D viewer accessible? Alt text? Screen reader descriptions? Keyboard controls for rotation?

### 17. Performance Budget
What's acceptable load time for the viewer? 2 seconds? 5 seconds? This affects whether we preload assets.

### 18. Analytics
Should we track which items/races are most viewed in the 3D viewer? Useful for understanding usage patterns.

## Next Steps (Recommended Order)

1. **Validate data source**: Download Turtle-WOW-DBC, confirm it has the itemId -> displayId mapping
2. **Prototype viewer**: Install wow-model-viewer, render a basic character with items
3. **Test CORS proxy**: Build the proxy route, measure performance
4. **Build displayId lookup**: Create the data pipeline to enrich our items.json
5. **Design the UI**: Tab layout, race/gender picker, gear panel, scrubber integration
6. **Implement**: Build the feature
7. **Fallback handling**: Handle items without display IDs gracefully

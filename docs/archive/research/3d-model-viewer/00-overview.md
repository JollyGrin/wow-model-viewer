# 3D Model Viewer Research Overview

## Goal

Build a new tab that renders a WoW character model wearing equipped gear, with a level scrubber that shows the best available gear from the user's progression list at each level.

## Research Documents

| Doc | Topic | Status |
|-----|-------|--------|
| [01-open-source-projects.md](./01-open-source-projects.md) | Available libraries, tools, GitHub repos | Complete |
| [02-model-formats.md](./02-model-formats.md) | M2, BLP, DBC formats and how gear rendering works | Complete |
| [03-turtle-wow-specifics.md](./03-turtle-wow-specifics.md) | Custom races, reskinned models, data sources | Complete |
| [04-wowhead-viewer.md](./04-wowhead-viewer.md) | How Wowhead's viewer works, CDN patterns, CORS | Complete |
| [05-data-gaps.md](./05-data-gaps.md) | What our current data has vs what we need | Complete |
| [06-approach-options.md](./06-approach-options.md) | Possible implementation strategies ranked | Complete |
| [07-open-questions.md](./07-open-questions.md) | Unknowns, risks, questions to answer | Complete |

## Key Finding Summary

The **primary blocker** is that our `items.json` has no `displayId` field. Every approach to 3D rendering requires mapping `itemId -> displayId -> model/texture`.

The **fastest viable path** is using the `wow-model-viewer` npm package (wraps Wowhead's ZamModelViewer) with a CORS proxy, feeding it `[slot, displayId]` pairs. This handles all the complex rendering (geosets, texture compositing, skeletal animation, attachment points) for us.

For Turtle WoW custom items, ~90%+ reuse vanilla display IDs. A small minority have truly custom models that would need fallback handling.

## Critical Data Source

**[oplancelot/Turtle-WOW-DBC](https://github.com/oplancelot/Turtle-WOW-DBC)** -- GitHub repo with 261 exported DBC files from Turtle WoW, including `ItemDisplayInfo.dbc` as JSON. This is the key to mapping item IDs to display IDs.

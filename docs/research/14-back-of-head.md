Research Summary: Back-of-Head Gap

How WoW handles head coverage

From the https://wowdev.wiki/Character_Customization,
https://wowdev.wiki/DB/CharHairGeosets, and the
https://github.com/danielsreichenbach/wowmodelview-vanilla:

WoW has a 3-part system for head coverage:

1. Body mesh (geoset 0) — has an intentional opening at the
   back/top of head
2. Hair geosets (2-18+) — different hairstyles, selected via
   CharHairGeosets.dbc
3. Scalp geoset (geoset 1) — the bald cap, shown only when
   Showscalp=1 or character is bald

The key field is Showscalp in CharHairGeosets.dbc. I parsed our
actual DBC data:

Human Male (Race=1, Sex=0):
Var GeosetID Showscalp
0 0 1 ← bald (no hair, show scalp)
1 2 0 ← hair covers head
2 3 0
3 4 0
4 5 0 ← THIS IS OUR HAIRSTYLE (geoset 5)
5 6 0
...

The critical finding

For our hairstyle (variation 4 → geoset 5), Showscalp=0 —
meaning the hair mesh is designed to FULLY cover the back of the
head by itself. We shouldn't need geoset 1 (scalp).

This rules out "missing geoset" as the cause. The hair geoset 5
should completely cover the gap, but it doesn't in our
rendering. The problem is upstream — either:

1. Bone transforms are positioning the hair incorrectly (making
   it too narrow/shifted), OR
2. The M2 → model.json conversion is dropping/corrupting hair
   vertices

Key source code references

From https://github.com/danielsreichenbach/wowmodelview-vanilla
charcontrol.cpp:
// Geoset 1 (scalp) shown only when bald
if (id == 1) model->showGeosets[j] = bald;

From https://github.com/Kelsidavis/WoWee — a different approach
where hair is group 1 (100+style+1), showing version
differences.

How to phrase the search question

For forums/Discord, the question would be:

"Rendering vanilla (1.12) M2 character models in WebGL/Three.js
— hair geosets appear too narrow and don't cover the back of the
head opening. Body mesh (geoset 0) has an intentional hole at
the back skull that hair is supposed to cover. Are the hair
submesh vertices in M2 local space (needing bone transforms to
position correctly) or already in world/bind pose? Using
embedded skin data (M2 v256, no external .skin file)."

Suggested next steps

1. Compare hair vertex positions — dump geoset 5 raw vertices
   and check their spatial extent. If they're clustered in a small
   area, they need bone transforms applied to spread them across
   the head.
2. Check if WMVx (https://github.com/Frostshake/WMVx) or
   WebWowViewerCpp (https://github.com/Deamon87/WebWowViewerCpp)
   apply bone transforms to vertex positions at load time.
3. Try enabling geoset 1 alongside geoset 5 as a quick
   experiment — even though Showscalp=0, it might help us
   understand the spatial relationship.

Sources:

- https://wowdev.wiki/Character_Customization
- https://wowdev.wiki/DB/CharHairGeosets
- https://wowdev.wiki/M2
- https://wowdev.wiki/M2/.skin
- https://github.com/danielsreichenbach/wowmodelview-vanilla —
  vanilla WoW model viewer C++ source
- https://github.com/Kelsidavis/WoWee — modern WoW model viewer
- https://github.com/Frostshake/WMVx — WMV rewrite
- https://github.com/Deamon87/WebWowViewerCpp — WebGL WoW viewer
- https://github.com/whoahq/whoa — WoW client reimplementation

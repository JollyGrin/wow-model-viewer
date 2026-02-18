# 02 - M2 Format Deep Dive

## M2 File Format (Vanilla 1.12.x)

M2 is Blizzard's proprietary 3D model format used for characters, creatures, items, and doodads. The definitive reference is [wowdev.wiki/M2](https://wowdev.wiki/M2).

---

## Header Structure

Vanilla 1.12.x uses M2 version **256-264** (pre-chunked format). Later versions (Legion+) use a chunked format with `MD21` magic -- those are NOT compatible with vanilla.

```c
struct M2Header {
    char     magic[4];           // "MD20"
    uint32_t version;            // 256-264 for vanilla
    M2Array  name;               // Model name string
    uint32_t globalFlags;        // 0x01=tilt_x, 0x02=tilt_y, 0x08=has_blend_maps
    M2Array  globalSequences;    // Global loop timers
    M2Array  animations;         // Animation sequences
    M2Array  animationLookup;    // Animation ID -> sequence index
    M2Array  bones;              // Skeleton bones
    M2Array  keyBoneLookup;      // Key bone indices
    M2Array  vertices;           // Vertex data
    uint32_t numSkinProfiles;    // Number of .skin files (LOD levels)
    M2Array  colors;             // Color animations
    M2Array  textures;           // Texture definitions
    M2Array  transparency;       // Transparency animations
    M2Array  textureAnimations;  // UV animations
    M2Array  textureReplace;     // Texture replacements
    M2Array  renderFlags;        // Material/blend mode settings
    M2Array  boneLookupTable;    // Bone index indirection
    M2Array  textureLookup;      // Texture index indirection
    M2Array  textureUnits;       // Texture unit definitions
    M2Array  transLookup;        // Transparency lookup
    M2Array  textureAnimLookup;  // Texture animation lookup
    // Bounding box, collision data...
    M2Array  boundTriangles;
    M2Array  boundVertices;
    M2Array  boundNormals;
    M2Array  attachments;        // Attachment points (weapon, helmet, etc.)
    M2Array  attachmentLookup;
    M2Array  events;             // Sound/effect triggers
    M2Array  lights;             // Model lights
    M2Array  cameras;            // Model cameras
    M2Array  cameraLookup;
    M2Array  ribbonEmitters;     // Ribbon effects (weapon trails)
    M2Array  particleEmitters;   // Particle effects
};

struct M2Array {
    uint32_t count;              // Number of elements
    uint32_t offset;             // Byte offset from start of file
};
```

---

## Vertex Format

```c
struct M2Vertex {
    float    position[3];        // X, Y, Z
    uint8_t  boneWeights[4];     // Blend weights (0-255, normalized to 0.0-1.0)
    uint8_t  boneIndices[4];     // Indices into boneLookupTable (NOT direct bone indices!)
    float    normal[3];          // Vertex normal
    float    texCoords[2];       // UV coordinates (primary)
    float    texCoords2[2];      // UV coordinates (secondary, used by some effects)
};
```

**Critical gotcha:** `boneIndices` reference the `boneLookupTable`, NOT the bone array directly. Missing this indirection is the most common parsing bug.

---

## Bone/Skeleton System

```c
struct M2Bone {
    int32_t  keyBoneId;          // Key bone ID (-1 if not a key bone)
    uint32_t flags;              // 0x08=billboard, 0x10=transformed
    int16_t  parentBone;         // Parent bone index (-1 for root)
    uint16_t submeshId;          // Submesh this bone belongs to
    uint16_t boneNameCRC;        // CRC of bone name (for lookup)
    uint16_t unknown;
    M2Track  translation;        // Translation animation (vec3)
    M2Track  rotation;           // Rotation animation (quaternion, compressed int16)
    M2Track  scale;              // Scale animation (vec3)
    float    pivot[3];           // Pivot point position
};
```

### Bone Hierarchy (Typical Character Model)

```
Root bone (pelvis/hips)
  +-- Spine1
  |   +-- Spine2
  |   |   +-- Neck
  |   |   |   +-- Head (attachment point: helmet, ID 11)
  |   |   +-- Shoulder.L
  |   |   |   +-- UpperArm.L
  |   |   |   |   +-- ForeArm.L
  |   |   |   |   |   +-- Hand.L (attachment: off-hand, ID 2)
  |   |   |   +-- ShoulderPad.L (attachment: left shoulder, ID 6)
  |   |   +-- Shoulder.R (mirror of left)
  |   |   |   +-- ... -> Hand.R (attachment: main hand, ID 1)
  |   |   |   +-- ShoulderPad.R (attachment: right shoulder, ID 5)
  |   |   +-- Cape/Cloak bones
  +-- UpperLeg.L
  |   +-- LowerLeg.L
  |   |   +-- Foot.L
  |   |       +-- Toe.L
  +-- UpperLeg.R (mirror)
  +-- Additional: tail (Tauren/Troll), ears, jaw, etc.
```

### Compressed Quaternion Rotation

Bone rotation uses compressed `int16[4]` quaternions. Conversion:
```
float_value = int16_value / 32767.0
```
This maps the int16 range `[-32767, 32767]` to `[-1.0, 1.0]`.

---

## Animation System

### Where Animation Data Lives

**In vanilla 1.12.x, ALL animation data is embedded inside the `.m2` file.** No external `.anim` files (those were introduced in WotLK 3.x).

### Animation Tracks (M2Track)

```c
struct M2Track {
    uint16_t interpolationType;  // 0=none, 1=linear, 2=hermite
    int16_t  globalSequence;     // -1 if driven by animation, else index into globalSequences
    M2Array  timestamps;         // Array of arrays: uint32_t timestamps per animation
    M2Array  values;             // Array of arrays: keyframe values per animation
};
```

**Sub-array structure:** Track data is organized as an array of arrays -- one sub-array per animation sequence. Many parsers incorrectly flatten this.

### Key Animation IDs

| ID | Name | Priority for Viewer |
|----|------|-------------------|
| 0 | Stand | **ESSENTIAL** - default idle |
| 4 | Walk | Nice to have |
| 5 | Run | Nice to have |
| 26-31 | Attack variants | Nice to have (AttackUnarmed, Attack1H, Attack2H) |
| 60-73 | Ready stances | Nice to have (ReadyUnarmed, Ready1H, Ready2H) |
| 51-52 | SpellCast | Nice to have |
| 143-148 | Stand variations | Fun (idle fidgets) |
| 157 | EmoteDance | Fun feature |

For a basic viewer, **only animation ID 0 (Stand)** is needed.

### Vertex Skinning

Standard linear blend skinning (LBS) with up to 4 bones per vertex:
```
finalPosition = sum(boneWeight[i] * boneMatrix[boneIndex[i]] * vertexPosition)
```

### Global Sequences vs Animation Sequences

Some tracks are driven by `globalSequences` (continuous independent loops) rather than the current character animation. Example: enchant glow pulsing on weapons. The `globalSequence` field on `M2Track` determines this (-1 = animation-driven, else = global sequence index).

---

## Skin Files (.skin)

The `.skin` file contains mesh/submesh definitions (triangle indices, submesh boundaries, material assignments). In vanilla, the highest-quality LOD is `*00.skin`.

```c
struct M2SkinHeader {
    char     magic[4];           // "SKIN" (or no magic in some versions)
    uint32_t nIndices;
    uint32_t ofsIndices;         // uint16_t vertex indices
    uint32_t nTriangles;
    uint32_t ofsTriangles;       // uint16_t triangle indices (groups of 3)
    uint32_t nProperties;
    uint32_t ofsProperties;      // Vertex properties (bone assignments)
    uint32_t nSubmeshes;
    uint32_t ofsSubmeshes;       // Submesh definitions
    uint32_t nTextureUnits;
    uint32_t ofsTextureUnits;    // Material/texture assignments
};

struct M2SkinSubmesh {
    uint16_t meshId;             // Geoset ID (see geoset system docs)
    uint16_t startVertex;
    uint16_t nVertices;
    uint16_t startTriangle;
    uint16_t nTriangles;
    uint16_t nBones;
    uint16_t startBone;
    uint16_t boneInfluences;     // Max bones per vertex in this submesh
    uint16_t rootBone;
    float    centerMass[3];
    float    centerBoundingBox[3];
    float    radius;
};
```

**Note:** `.skin` files DO exist in vanilla 1.12.x despite some sources saying otherwise. The mesh data is split out from the M2 into skin files. If you use a WotLK+ parser, it will handle this correctly.

---

## Texture Types

The M2 file references textures by type:

| Type | Name | Source |
|------|------|--------|
| 0 | Hardcoded | Filename stored in M2 file |
| 1 | Character Skin | Resolved at runtime from CharSections.dbc |
| 2 | Cape | Resolved from equipment data (ItemDisplayInfo) |
| 6 | Character Hair | Resolved at runtime from CharSections.dbc |
| 8 | Monster Skin 1 | CreatureDisplayInfo texture override |
| 11 | Monster Skin 2 | Second creature texture |
| 12 | Monster Skin 3 | Third creature texture |

**Types 1, 2, and 6 are NOT stored in the M2 file.** They must be resolved at runtime from DBC data and character customization choices. A parser that only handles type 0 will have missing textures on character models.

---

## Attachment Points

```c
struct M2Attachment {
    uint32_t id;                 // Attachment type ID
    uint16_t bone;               // Bone index to attach to
    uint16_t unknown;
    float    position[3];        // Offset from bone
    M2Track  animateAttached;    // Visibility animation
};
```

### Standard Attachment IDs

| ID | Name | Used For |
|----|------|----------|
| 0 | MountMain | Ground mount position |
| 1 | HandRight | Main hand weapon (in combat) |
| 2 | HandLeft | Off hand weapon/shield (in combat) |
| 5 | ShoulderRight | Right shoulder pad |
| 6 | ShoulderLeft | Left shoulder pad |
| 11 | Head | Helmet model |
| 15 | BackSheath | 2H weapon sheathed on back |
| 16 | BackSheath2 | Second back sheath |
| 17 | HipSheath | 1H weapon sheathed at hip |
| 18 | SpellHandRight | Right hand spell effects |
| 19 | SpellHandLeft | Left hand spell effects |
| 26 | ShieldAttach | Shield sheathed on back |

---

## Particle and Ribbon Emitters

### Particle Emitters
Used for spell effects, enchant glows, ambient effects. Complex system with properties like emission rate, lifetime, gravity, color over time, size over time, etc.

### Ribbon Emitters
Used for weapon swing trails. Properties include:
- Material/texture references
- Color and alpha over time
- Edge lifetime (how long the trail persists)
- Edges per second (trail resolution)

**For an initial viewer, particle and ribbon emitters can be skipped.** They add visual polish but are not essential for character/equipment display.

---

## Coordinate System

WoW uses a **right-handed coordinate system with Z-up**. Three.js uses Y-up. You need to rotate the entire model:
```javascript
// WoW to Three.js coordinate conversion
model.rotation.x = -Math.PI / 2;
// Or swap Y and Z during vertex loading
```

## Triangle Winding

M2 uses **clockwise** winding. If your renderer expects counter-clockwise (Three.js default), set:
```javascript
material.side = THREE.FrontSide; // May need to flip normals or reverse index order
```

---

## Key Gotchas

1. **Bone index indirection**: Vertex `boneIndices` -> `boneLookupTable` -> actual bone array
2. **Animation sub-arrays**: Track data has one sub-array per animation sequence, not flat
3. **Coordinate system**: Z-up (WoW) vs Y-up (Three.js)
4. **Triangle winding**: Clockwise (M2) vs counter-clockwise (Three.js default)
5. **Texture types 1, 2, 6**: Not in the M2 file, resolved from DBC at runtime
6. **Global sequences**: Some animations loop independently of character animation state
7. **Quaternion compression**: int16/32767 encoding for bone rotations

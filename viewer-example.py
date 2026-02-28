"""
Interactive M2 model viewer and vertex editor.

4-panel layout: Front, Left, Back (preset cameras), Free (interactive).
Left-click a vertex in any view to select it, drag sphere widget to move.
Use checkboxes in the free view to toggle geoset groups.
Press 'q' to quit.

Textures:
  BLP textures are loaded from the same directory as the M2 file.
  Two resolution methods are used:

  1. Replaceable textures (Body, Fur, Cape, etc.) use the naming convention:
       {ModelName}Skin00_XX.blp        -> Body texture
       {ModelName}Skin00_XX_Extra.blp  -> Fur/overlay texture
     where XX is a variant number (e.g. 00, 01, 05). When multiple variants
     exist, the highest-numbered pair is used.

  2. Hardcoded textures have an internal path in the M2 like
     "Creature\\Bear\\BearSkin.blp". The viewer checks the M2's directory
     first, then walks up parent directories trying the full relative path.
     For example, if the M2 is at project/Models/Bear.m2 and the texture
     path is "Creature\\Bear\\BearSkin.blp", it will find it at
     project/Creature/Bear/BearSkin.blp.

  Run the viewer to see the texture table and what was resolved.


M2 File Format (vanilla WoW 1.12, version 256)
===============================================

An M2 file is a binary model container. All integers are little-endian.

Header (starts at offset 0):
  0x00  char[4]   magic         "MD20"
  0x04  uint32    version       256 for vanilla
  0x08  uint32+   name          count/offset pair -> null-terminated ASCII
  0x10  uint32    globalFlags
  ...followed by count/offset pairs (each uint32 count + uint32 offset)
  for every data block. Key blocks at fixed offsets:

  0x1C  anim_sequences    Animation sequence metadata
  0x34  bones             Skeleton bones
  0x44  vertices          Vertex data
  0x4C  skin_profiles     LOD skin/view data (inline in vanilla)
  0x54  colors            Color/alpha animation tracks
  0x5C  textures          Texture definitions
  0xB4  bb_min            Bounding box minimum (3 floats)
  0xC0  bb_max            Bounding box maximum (3 floats)
  0xCC  bb_radius         Bounding sphere radius (float)

Vertex (48 bytes each, format '<3f4B4B3f2f2f'):
  3 floats   position      x, y, z  (Y is left/right, model faces +X)
  4 uint8    bone_weights  w0..w3, sum to 255
  4 uint8    bone_indices  i0..i3, index into bone array
  3 floats   normal        nx, ny, nz
  2 floats   uv1           u, v  (primary texture coords)
  2 floats   uv2           u, v  (secondary texture coords)

Bone / M2CompBone (108 bytes each):
  int32    key_bone_id    -1 if not a named bone (e.g. jaw, weapon attach)
  uint32   flags
  int16    parent         -1 if root bone
  uint16   submesh_id
  M2Track  translation    28 bytes, vec3 keyframes
  M2Track  rotation       28 bytes, quat (x,y,z,w) keyframes
  M2Track  scale          28 bytes, vec3 keyframes
  3 floats pivot          world-space pivot point

  Transform order: T(pivot) * T(translation) * R(rotation) * S(scale) * T(-pivot)
  Bones form a parent chain; final transform = parent_world * local.

M2Track (28 bytes, vanilla "old" format):
  int16    interp_type    0=none (step), 1=linear
  int16    global_seq     -1 = per-animation, else global sequence index
  uint32+  ranges         count/offset -> (uint32 start_idx, uint32 end_idx) per anim
  uint32+  timestamps     count/offset -> flat uint32 array (milliseconds)
  uint32+  values         count/offset -> flat value array (vec3=12B or quat=16B)

  Keyframes use a global timeline. Each animation's range pair indexes into
  the shared timestamp/value arrays. Local time (0..duration) is offset by
  the first timestamp in the range.

Animation Sequence (68 bytes each):
  uint16   anim_id        animation type (0=Stand, 1=Death, 4=Walk, 5=Run, ...)
  uint16   sub_id         variation index
  uint32   global_start   start on the global timeline (ms)
  uint32   global_end     end on the global timeline (ms)
  float    move_speed
  uint32   flags
  ...      padding/unused fields to 68 bytes

Texture Definition (16 bytes each):
  uint32   type       0=Hardcoded (filename embedded), or replaceable:
                        1=Body/skin, 2=Cape, 6=Hair, 8=Fur/second_skin,
                        11=Creature1, 12=Creature2, 13=Creature3
  uint32   flags
  uint32+  filename   count/offset -> ASCII path (only for type 0)

  Replaceable textures have no filename; the client swaps them based on
  character customization (skin color, hair, etc.).

Skin / View (inline in vanilla M2, pointed to by skin_profiles):
  The skin block starts with 5 count/offset pairs (each uint32+uint32)
  plus a trailing bones count (uint32), totaling 44 bytes:
    vertices     local vertex index list (uint16 -> global vertex indices)
    indices      triangle index list (uint16 -> local vertex list)
    properties   bone lookup / vertex properties (unused by this viewer)
    submeshes    M2SkinSection array (32 bytes each)
    batches      M2Batch / texture unit array (24 bytes each)
    nBones       uint32

  M2SkinSection / Submesh (32 bytes, key fields):
    uint16   skinSectionId   encodes geoset: group = id//100, variant = id%100
    uint16   level           LOD level
    uint16   vertexStart     start in local vertex list
    uint16   vertexCount
    uint16   indexStart      start in triangle index list
    uint16   indexCount      number of triangle indices (tris = indexCount/3)

  M2Batch / Texture Unit (24 bytes, key fields):
    uint8    flags
    uint8    priority
    uint16   skinSectionIndex   which submesh this batch draws
    ...
    uint16   colorIndex         index into M2 color tracks
    uint16   materialIndex      index into render flags (blend mode)
    ...
    uint16   texComboIndex      index into texture lookup table
    ...
    uint16   transparencyIndex  index into transparency lookup

  Texture assignment chain:
    batch.texComboIndex -> textureLookup[i] -> textureTable[j].type
    This indirection lets one submesh render with multiple texture passes
    (e.g. body skin + fur overlay on different faces).

Geoset Naming:
  skinSectionId encodes group and variant:
    0      = Body (group 0, variant 0)
    101    = Hair variant 1
    201    = Facial1 variant 1
    1501   = Cape variant 1
  Group names: 0=Body, 1=Hair, 2=Facial 1, 3=Facial 2, 4=Bracers, 5=Boots,
  7=Ears, 8=Sleeves, 9=Kneepads, 10=Chest, 11=Pants, 12=Tabard, 13=Legs,
  14=Cloak, 15=Cape, 16=Loincloth, 17=Eyeglow, 18=Belt


BLP2 Texture Format
===================

Header at offset 0:
  0x00  char[4]   signature    "BLP2"
  0x04  uint32    type         always 1
  0x08  uint8     colorEnc     1=palette, 2=DXTC, 3=uncompressed ARGB
  0x09  uint8     alphaDepth   0, 1, 4, or 8 bits
  0x0A  uint8     alphaEnc     0=DXT1, 1=DXT3, 7=DXT5 (only when colorEnc=2)
  0x0B  uint8     hasMips
  0x0C  uint32    width
  0x10  uint32    height
  0x14  uint32[16] mipOffsets   file offset for each mip level
  0x54  uint32[16] mipSizes     byte size for each mip level

  Palette mode (colorEnc=1):
    0x94  uint8[1024]  palette    256 entries x 4 bytes (BGRA)
    Pixel data at mipOffsets[0]: 1 byte per pixel (palette index),
    then alpha bytes follow (format depends on alphaDepth).

  DXTC mode (colorEnc=2), format depends on alphaDepth + alphaEnc:
    alphaDepth=0                  -> DXT1 (no alpha, 8 bytes per 4x4 block)
    alphaDepth>0, alphaEnc=0     -> DXT1 (1-bit color-key alpha)
    alphaDepth>0, alphaEnc=1     -> DXT3 (explicit 4-bit alpha, 16B/block)
    alphaDepth>0, alphaEnc=7     -> DXT5 (interpolated alpha, 16B/block)


Texture Resolution
==================

BLP textures are found by searching from the M2 file's directory:

1. Replaceable textures (Body, Fur, Cape, etc.) match by naming convention:
     {ModelName}Skin00_XX.blp        -> Body texture (type 1)
     {ModelName}Skin00_XX_Extra.blp  -> Fur/overlay texture (type 8)
   XX is a variant number (00, 01, 05, ...). The highest-numbered pair is used.

2. Hardcoded textures (type 0) have a file path embedded in the M2. The viewer
   checks the M2's own directory first (by filename, case-insensitive), then
   walks up parent directories trying the full relative path at each level.

Run the viewer to see the texture table and what was resolved.


Controls
========

Mouse:
  Left-click        Select nearest vertex (in selection mode)
  Shift+left-click  Add to selection
  Left-drag         Box select (in selection mode)
  Right-click       Deselect nearest vertex
  Scroll            Zoom (synced across all 4 views)
  Middle-drag       Pan (Free view only; preset views track it)

Keys:
  G                 Toggle selection/edit mode vs camera mode
  Q                 Quit

  Ctrl+S            Save M2
  Ctrl+Shift+S      Save As

  A                 Cycle to next animation
  P                 Toggle animation preview (rest pose vs animated)
  Left/Right        Step animation backward/forward one frame

  B                 Toggle bone weight visualization
  Up/Down           Next/previous bone (in bone vis mode)
  W / Shift+W       Increase/decrease bone weight on selected verts

  S / Shift+S       Scale selection up/down
  M                 Mirror selection across Y=0

  Ctrl+Z            Undo vertex move (or weight edit in bone mode)
  Ctrl+Shift+Z      Redo vertex move (or weight edit in bone mode)
  Ctrl+A            Undo selection change
  Ctrl+Shift+A      Redo selection change
"""

import sys
import math
import time
import types
import tkinter as tk
from tkinter import filedialog
from collections import defaultdict
from pathlib import Path
import importlib.util

_missing = []
for _mod in ('numpy', 'vtk', 'pyvista'):
    if importlib.util.find_spec(_mod) is None:
        _missing.append(_mod)
if _missing:
    _pkgs = ' '.join(_missing)
    print(f"Missing required packages: {', '.join(_missing)}")
    print(f"  pip install {_pkgs}")
    print(f"or with a venv:")
    print(f"  python -m venv .venv && .venv/bin/pip install {_pkgs}")
    print(f"  .venv/bin/python viewer.py <model.m2>")
    sys.exit(1)

import numpy as np
import vtk
import pyvista as pv

# ---------------------------------------------------------------------------
# wow_tools imports
# ---------------------------------------------------------------------------
_wt_dir = Path(__file__).resolve().parent / 'wow_tools'
if not _wt_dir.is_dir():
    print(f"Cannot find wow_tools directory at {_wt_dir}")
    sys.exit(1)


def _import_wt(name):
    spec = importlib.util.spec_from_file_location(name, _wt_dir / f'{name}.py')
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


m2_format = _import_wt('m2_format')
load_m2 = m2_format.load_m2
save_m2 = m2_format.save_m2
M2File = m2_format.M2File
M2Track = m2_format.M2Track
GEOSET_NAMES = m2_format.GEOSET_NAMES
TEX_TYPE_NAMES = m2_format.TEX_TYPE_NAMES

if 'bpy' not in sys.modules:
    sys.modules['bpy'] = types.ModuleType('bpy')
blp_decode = _import_wt('blp_decode')
decode_blp = blp_decode.decode_blp


# ---------------------------------------------------------------------------
# Animation evaluation helpers
# ---------------------------------------------------------------------------

def _lerp(a, b, t):
    """Linear interpolation between tuples a and b."""
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(len(a)))


def _quat_dot(a, b):
    return sum(a[i] * b[i] for i in range(4))


def _nlerp(a, b, t):
    """Normalized linear interpolation for quaternions (x, y, z, w)."""
    if _quat_dot(a, b) < 0:
        b = tuple(-b[i] for i in range(4))
    q = _lerp(a, b, t)
    length = math.sqrt(sum(c * c for c in q))
    if length < 1e-10:
        return (0.0, 0.0, 0.0, 1.0)
    return tuple(c / length for c in q)


def _quat_to_matrix(q):
    """Convert quaternion (x, y, z, w) to 3x3 rotation matrix."""
    x, y, z, w = q
    xx, yy, zz = x*x, y*y, z*z
    xy, xz, yz = x*y, x*z, y*z
    wx, wy, wz = w*x, w*y, w*z
    return np.array([
        [1 - 2*(yy+zz),     2*(xy-wz),     2*(xz+wy)],
        [    2*(xy+wz), 1 - 2*(xx+zz),     2*(yz-wx)],
        [    2*(xz-wy),     2*(yz+wx), 1 - 2*(xx+yy)],
    ], dtype=np.float64)


def evaluate_track(track: M2Track, anim_index: int, time_ms: int,
                   anim_duration: int = 0, is_quat: bool = False):
    """Evaluate an M2Track at a given animation index and local time."""
    if not track.values:
        return None
    if anim_index < len(track.ranges):
        start_idx, end_idx = track.ranges[anim_index]
    else:
        return None
    if start_idx >= end_idx or start_idx >= len(track.timestamps):
        return None
    end_idx = min(end_idx, len(track.timestamps))
    ts = track.timestamps
    vals = track.values
    base_time = ts[start_idx]
    global_time = base_time + time_ms
    if global_time <= ts[start_idx]:
        return vals[start_idx]
    if global_time >= ts[end_idx - 1]:
        return vals[end_idx - 1]
    lo, hi = start_idx, end_idx - 1
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if ts[mid] <= global_time:
            lo = mid
        else:
            hi = mid
    if track.interp_type == 0 or ts[hi] == ts[lo]:
        return vals[lo]
    t = (global_time - ts[lo]) / (ts[hi] - ts[lo])
    if is_quat:
        return _nlerp(vals[lo], vals[hi], t)
    else:
        return _lerp(vals[lo], vals[hi], t)


def evaluate_bone_transform(bones, bone_index, anim_index, time_ms,
                            anim_duration=0, cache=None):
    """Compute the world-space 4x4 transform for a bone at a given time."""
    if cache is not None and bone_index in cache:
        return cache[bone_index]
    bone = bones[bone_index]
    pivot = np.array(bone.pivot, dtype=np.float64)
    trans = evaluate_track(bone.translation, anim_index, time_ms, anim_duration)
    rot = evaluate_track(bone.rotation, anim_index, time_ms, anim_duration,
                         is_quat=True)
    scl = evaluate_track(bone.scale, anim_index, time_ms, anim_duration)
    t_neg_pivot = np.eye(4, dtype=np.float64)
    t_neg_pivot[:3, 3] = -pivot
    s_mat = np.eye(4, dtype=np.float64)
    if scl is not None:
        s_mat[0, 0] = scl[0]; s_mat[1, 1] = scl[1]; s_mat[2, 2] = scl[2]
    r_mat = np.eye(4, dtype=np.float64)
    if rot is not None:
        r_mat[:3, :3] = _quat_to_matrix(rot)
    t_trans = np.eye(4, dtype=np.float64)
    if trans is not None:
        t_trans[:3, 3] = trans
    t_pivot = np.eye(4, dtype=np.float64)
    t_pivot[:3, 3] = pivot
    local = t_pivot @ t_trans @ r_mat @ s_mat @ t_neg_pivot
    if bone.parent >= 0:
        parent_mat = evaluate_bone_transform(bones, bone.parent, anim_index,
                                             time_ms, anim_duration, cache)
        world = parent_mat @ local
    else:
        world = local
    if cache is not None:
        cache[bone_index] = world
    return world


def compute_deformed_positions(m2: M2File, anim_index: int,
                               time_ms: int) -> np.ndarray:
    """Compute deformed vertex positions for a given animation frame."""
    n_verts = len(m2.vertices)
    result = np.zeros((n_verts, 3), dtype=np.float64)
    anim_duration = 0
    if anim_index < len(m2.animations):
        anim_duration = m2.animations[anim_index].duration
    cache = {}
    bone_matrices = []
    for bi in range(len(m2.bones)):
        mat = evaluate_bone_transform(m2.bones, bi, anim_index, time_ms,
                                      anim_duration, cache)
        bone_matrices.append(mat)
    for vi in range(n_verts):
        v = m2.vertices[vi]
        pos = np.array([v.pos[0], v.pos[1], v.pos[2], 1.0], dtype=np.float64)
        deformed = np.zeros(3, dtype=np.float64)
        for j in range(4):
            w = v.bone_weights[j]
            if w == 0:
                continue
            bi = v.bone_indices[j]
            if bi < len(bone_matrices):
                transformed = bone_matrices[bi] @ pos
                deformed += (w / 255.0) * transformed[:3]
        result[vi] = deformed
    return result


# ---------------------------------------------------------------------------
# Texture resolution — matches wow_tools/import_m2.py conventions
# ---------------------------------------------------------------------------

def _find_texture_files(m2_dir, model_base):
    """Search for BLP textures adjacent to the M2 file.

    Returns a dict: texture_type (int) -> blp_path (Path).
    Case-insensitive matching for Linux compatibility.

    For character models, the naming convention is:
      Type 1 (Body): {ModelBase}Skin00_XX.blp
      Type 8 (Fur):  {ModelBase}Skin00_XX_Extra.blp

    Prefers the highest-numbered variant where both base+Extra exist.
    Falls back to highest-numbered base skin if no pairs found.
    """
    tex_map = {}
    m2_dir = Path(m2_dir)
    model_base_lower = model_base.lower()

    if not m2_dir.is_dir():
        return tex_map

    all_blps = sorted(
        f for f in m2_dir.iterdir()
        if f.suffix.lower() == '.blp' and f.stem.lower().startswith(model_base_lower)
    )

    skin_prefix_lower = (model_base + "skin").lower()
    base_skins = {}
    extra_skins = {}
    plain_texture = None

    for blp in all_blps:
        stem_lower = blp.stem.lower()
        if stem_lower == model_base_lower:
            plain_texture = blp
            continue
        if not stem_lower.startswith(skin_prefix_lower):
            if plain_texture is None:
                plain_texture = blp
            continue
        suffix = stem_lower[len(skin_prefix_lower):]
        if suffix.endswith('_extra'):
            key = suffix[:-6]
            extra_skins[key] = blp
        else:
            base_skins[suffix] = blp

    paired = sorted(set(base_skins.keys()) & set(extra_skins.keys()), reverse=True)
    if paired:
        key = paired[0]
        tex_map[1] = base_skins[key]
        tex_map[8] = extra_skins[key]
    else:
        if base_skins:
            key = sorted(base_skins.keys(), reverse=True)[0]
            tex_map[1] = base_skins[key]
        if extra_skins:
            key = sorted(extra_skins.keys(), reverse=True)[0]
            tex_map[8] = extra_skins[key]

    if not tex_map and plain_texture:
        tex_map[11] = plain_texture

    if not tex_map:
        for blp in all_blps:
            tex_map.setdefault(11, blp)
            break

    return tex_map


def _resolve_texture_path(tex_path, local_dir):
    """Resolve a hardcoded M2 texture path to a file on disk.

    Checks the local directory first (by filename), then walks up parent
    directories trying the full relative path at each level.
    """
    tex_norm = tex_path.replace('\\', '/')
    tex_name = Path(tex_norm).name

    # Check local directory (case-insensitive)
    for f in local_dir.iterdir():
        if f.name.lower() == tex_name.lower():
            return f

    # Walk up parents and try the full relative path
    for parent in local_dir.parents:
        candidate = parent / tex_norm
        if candidate.exists():
            return candidate
        if parent == parent.parent:
            break

    return None


def _resolve_textures(m2, m2_path):
    """Resolve BLP textures for an M2 model using wow_tools conventions.

    Combines:
    1. Adjacent file search (character skin naming convention)
    2. M2 texture table entries (hardcoded paths for doodads/creatures)

    Returns dict mapping texture table index (int) -> Path to BLP file.
    Keys match submesh_tex_index values so the viewer can look up the right
    texture per geoset.
    """
    m2_dir = Path(m2_path).parent
    clean_name = m2.name.strip('\x00').strip() if m2.name else ''
    model_base = Path(clean_name).stem if clean_name else Path(m2_path).stem

    # Adjacent file search returns keys by texture TYPE (1=Body, 8=Fur, etc.)
    by_type = _find_texture_files(m2_dir, model_base)

    tex_files = {}

    if m2.textures:
        # Remap type-keyed results to table indices, and resolve hardcoded paths
        for i, tex in enumerate(m2.textures):
            if not tex.filename:
                # Replaceable texture — match by type from adjacent files
                if tex.type in by_type:
                    tex_files[i] = by_type[tex.type]
            else:
                # Hardcoded path — check local dir, then walk parents
                resolved = _resolve_texture_path(tex.filename, m2_dir)
                if resolved:
                    tex_files[i] = resolved
    else:
        # No texture table — pass type-keyed map through as-is
        tex_files = by_type

    return tex_files

SELECTION_RADIUS = 0.05
DESELECTION_RADIUS = 0.01  # tighter than selection to avoid removing too many
WIDGET_RADIUS = 0.03
WIDGET_OFFSET = 0.15     # distance to push widget outward along average normal
BOX_DRAG_THRESHOLD = 20   # pixels: distinguish click from drag
BOX_DRAG_TIMEOUT = 0.2   # seconds: max time after press to start a drag

# Default visibility: group -> set of variants (None = all variants)
DEFAULT_VISIBLE = {0: None, 2: None, 3: None, 4: {1}, 5: {1}, 7: None, 13: {1}, 15: {1}}
ROW_H = 30
COL1_X = 10
COL2_X = 230

# Subplot positions
FRONT = (0, 0)
LEFT  = (0, 1)
BACK  = (1, 0)
FREE  = (1, 1)
ALL_VIEWS = [FRONT, LEFT, BACK, FREE]

# Model center (approximate for character models, Z-up)
MODEL_CENTER = (0.0, 0.0, 1.1)
CAM_DIST = 4.0


def _cam(pos, center=MODEL_CENTER, up=(0, 0, 1)):
    """Build a PyVista camera_position tuple."""
    return [pos, center, up]


# Camera presets: (position, focal_point, view_up)
# WoW M2 models face toward +X; Y is left/right.
CAMERAS = {
    FRONT: _cam((CAM_DIST, 0, MODEL_CENTER[2])),
    LEFT:  _cam((0, CAM_DIST, MODEL_CENTER[2])),
    BACK:  _cam((-CAM_DIST, 0, MODEL_CENTER[2])),
}

VIEW_LABELS = {
    FRONT: "Front",
    LEFT: "Left",
    BACK: "Back",
    FREE: "Free",
}


class M2Viewer:
    def __init__(self, m2: M2File, texture_paths: dict = None):
        self.m2 = m2
        self.selected = []
        self.original_positions = {}
        self.points = np.array([v.pos for v in m2.vertices], dtype=np.float32)

        # UV coordinates for all vertices (V flipped for OpenGL convention)
        self.uvs = np.array(
            [[v.uv1[0], 1.0 - v.uv1[1]] for v in m2.vertices], dtype=np.float32
        )

        # Load textures: key -> pv.Texture
        # key matches texture_paths keys (texture table index or texture type)
        self.pv_textures = {}
        if texture_paths:
            for tex_key, blp_path in texture_paths.items():
                try:
                    w, h, rgba = decode_blp(str(blp_path))
                    self.pv_textures[tex_key] = pv.numpy_to_texture(rgba)
                    ttype_str = ""
                    if m2.textures and isinstance(tex_key, int) and tex_key < len(m2.textures):
                        ttype_str = f" ({TEX_TYPE_NAMES.get(m2.textures[tex_key].type, '')})"
                    print(f"  Loaded texture [{tex_key}]{ttype_str}: {blp_path} ({w}x{h})")
                except Exception as e:
                    print(f"  Warning: failed to load texture {blp_path}: {e}")

        # Build per-submesh texture mapping: submesh index -> tex table key
        self._sm_tex = {}
        if m2.skin:
            for i, sm in enumerate(m2.skin.submeshes):
                if getattr(m2.skin, 'submesh_tex_index', None) and i in m2.skin.submesh_tex_index:
                    self._sm_tex[i] = m2.skin.submesh_tex_index[i]
                elif m2.skin.submesh_tex_type and i in m2.skin.submesh_tex_type:
                    self._sm_tex[i] = m2.skin.submesh_tex_type[i]

        # Build face data keyed by render key (group, variant, tex_key).
        # Each submesh's faces go into the bucket matching its texture so
        # faces within the same geoset can have different textures.
        tri = m2.skin.tri_indices
        self.gv_faces = {}   # render_key -> face array
        rk_tris = defaultdict(list)
        for i, sm in enumerate(m2.skin.submeshes):
            tex_key = self._sm_tex.get(i, -1)
            rk = (sm.group, sm.variant, tex_key)
            for j in range(sm.index_start, sm.index_start + sm.index_count, 3):
                rk_tris[rk].append((tri[j], tri[j+1], tri[j+2]))
        for rk, tlist in rk_tris.items():
            n = len(tlist)
            faces = np.zeros(n * 4, dtype=np.int32)
            for i, (a, b, c) in enumerate(tlist):
                faces[i*4] = 3; faces[i*4+1] = a; faces[i*4+2] = b; faces[i*4+3] = c
            self.gv_faces[rk] = faces

        # Map (group, variant) -> list of render keys for that geoset
        self.gv_render_keys = defaultdict(list)
        for rk in self.gv_faces:
            self.gv_render_keys[(rk[0], rk[1])].append(rk)

        # Organize by group (visibility operates on (group, variant))
        all_gv = set(self.gv_render_keys.keys())
        self.groups = sorted(set(k[0] for k in all_gv))
        self.group_variants = {}
        for g in self.groups:
            self.group_variants[g] = sorted(k[1] for k in all_gv if k[0] == g)

        # Visibility state: (group, variant) -> bool
        self.gv_visible = {}
        for gv in all_gv:
            group, variant = gv
            if group in DEFAULT_VISIBLE:
                allowed = DEFAULT_VISIBLE[group]
                self.gv_visible[gv] = allowed is None or variant in allowed
            else:
                self.gv_visible[gv] = False

        # Per-subplot actors and meshes: view -> {render_key -> actor/mesh}
        self.view_actors = {v: {} for v in ALL_VIEWS}
        self.view_meshes = {v: {} for v in ALL_VIEWS}
        # Selection actors/meshes per view
        self.selection_actors = {v: None for v in ALL_VIEWS}
        self.selection_meshes = {v: None for v in ALL_VIEWS}

        # Popout state
        self.expanded_group = None
        self.variant_widgets = []
        self.popout_bg = None

        self.plotter = pv.Plotter(
            title=f"M2 Editor: {m2.name}",
            shape=(2, 2),
            window_size=(1400, 1000),
        )
        self.widgets = {}  # view -> sphere widget
        self._widget_center = np.zeros(3)  # current widget position (for drag delta)
        self._syncing_zoom = False
        self._syncing_widgets = False

        # Separate undo/redo stacks for motion (vertex positions), selection, and weights
        self.motion_undo = []
        self.motion_redo = []
        self.selection_undo = []
        self.selection_redo = []
        self.weight_undo = []
        self.weight_redo = []

        # Save path (defaults to loaded file)
        self.save_path = str(m2.path)

        # Mode toggle: True = selection/edit, False = camera
        self.selection_mode = False

        # Rubber band box selection state
        self._box_start = None       # (x, y) display coords
        self._box_press_time = 0     # monotonic timestamp of press
        self._box_renderer = None    # renderer where drag started
        self._box_view = None        # view tuple where drag started
        self._box_dragging = False   # True once mouse moved beyond threshold (confirmed drag)
        self._rb_actor = None        # 2D rubber band actor
        self._rb_renderer = None     # renderer holding the rubber band actor
        self._widget_dragging = False  # True when a sphere widget is being dragged
        self._in_pick = False          # re-entrance guard for pick/select

        # Pre-compute mirror pairs from original vertex positions (Y=0 symmetry)
        self._mirror_map = self._build_mirror_map()

        # Animation preview state
        self.anim_preview = False      # True when showing animation pose
        self.anim_index = 0            # current animation index
        self.anim_time_ms = 0          # current local time within animation
        self.anim_step_ms = 33         # frame step size (~30 fps)

        # Bone weight visualization state
        self.bone_vis_mode = False     # True when showing bone weight colors
        self.bone_vis_index = 0        # which bone to visualize weights for
        self.weight_edit_bone = 0      # bone index for weight editing
        self.weight_edit_delta = 25    # weight change per W/Shift+W press

        # Cached deformed positions (updated each animation frame)
        self._deformed_points = None   # np array or None when in rest pose

    def _setup_zoom_sync(self):
        """Sync zoom and pan across all 4 views, lock preset camera angles.

        Uses parallel projection so zoom is controlled by parallel_scale.
        Preset views (Front/Left/Back) keep their viewing direction but
        track the Free view's focal point, so panning in Free view shifts
        all views to the same area.
        """
        n_cols = 2

        # Store preset camera directions (unit vector from focal to position)
        # and the initial focal point so we can reconstruct after panning.
        self._locked_cams = {}
        self._cam_directions = {}
        for view in [FRONT, LEFT, BACK]:
            idx = view[0] * n_cols + view[1]
            cam = self.plotter.renderers[idx].GetActiveCamera()
            pos = np.array(cam.GetPosition())
            focal = np.array(cam.GetFocalPoint())
            self._locked_cams[idx] = {
                'pos': cam.GetPosition(),
                'focal': cam.GetFocalPoint(),
                'up': cam.GetViewUp(),
            }
            self._cam_directions[idx] = {
                'offset': pos - focal,  # direction * distance
                'up': np.array(cam.GetViewUp()),
            }

        # Shared pan offset from MODEL_CENTER, updated when Free view pans
        self._pan_offset = np.zeros(3)
        free_idx = FREE[0] * n_cols + FREE[1]

        def make_observer(source_idx):
            def on_modified(caller, event):
                if self._syncing_zoom:
                    return
                self._syncing_zoom = True

                # If Free view changed, detect pan (focal point shift)
                if source_idx == free_idx and source_idx not in self._locked_cams:
                    new_focal = np.array(caller.GetFocalPoint())
                    self._pan_offset = new_focal - np.array(MODEL_CENTER)

                    # Update preset views to track the new focal point
                    for preset_idx, direction in self._cam_directions.items():
                        new_f = np.array(MODEL_CENTER) + self._pan_offset
                        new_p = new_f + direction['offset']
                        self._locked_cams[preset_idx] = {
                            'pos': tuple(new_p),
                            'focal': tuple(new_f),
                            'up': tuple(direction['up']),
                        }
                        pcam = self.plotter.renderers[preset_idx].GetActiveCamera()
                        pcam.SetFocalPoint(tuple(new_f))
                        pcam.SetPosition(tuple(new_p))

                # If this is a locked view, restore its angle (keep only zoom)
                if source_idx in self._locked_cams:
                    lock = self._locked_cams[source_idx]
                    caller.SetPosition(lock['pos'])
                    caller.SetFocalPoint(lock['focal'])
                    caller.SetViewUp(lock['up'])

                # Propagate zoom to all other views
                scale = caller.GetParallelScale()
                for i, view in enumerate(ALL_VIEWS):
                    idx = view[0] * n_cols + view[1]
                    if idx != source_idx:
                        cam = self.plotter.renderers[idx].GetActiveCamera()
                        cam.SetParallelScale(scale)
                self.plotter.render()
                self._syncing_zoom = False
            return on_modified

        for view in ALL_VIEWS:
            idx = view[0] * n_cols + view[1]
            cam = self.plotter.renderers[idx].GetActiveCamera()
            cam.ParallelProjectionOn()
            cam.AddObserver('ModifiedEvent', make_observer(idx))

    def _make_mesh(self, rk):
        """Build a PyVista mesh for a render key (group, variant, tex_key)."""
        mesh = pv.PolyData(self.points.copy(), self.gv_faces[rk])
        tex_key = rk[2]
        if tex_key in self.pv_textures:
            mesh.active_texture_coordinates = self.uvs.copy()
        return mesh

    def _add_mesh_all_views(self, gv):
        """Add all render meshes for a (group, variant) to all 4 subplots."""
        for rk in self.gv_render_keys[gv]:
            tex_key = rk[2]
            pv_tex = self.pv_textures.get(tex_key)
            for view in ALL_VIEWS:
                mesh = self._make_mesh(rk)
                self.plotter.subplot(*view)
                name = f"gv_{rk[0]}_{rk[1]}_{rk[2]}_{view[0]}{view[1]}"
                if pv_tex is not None:
                    actor = self.plotter.add_mesh(
                        mesh, texture=pv_tex, show_edges=True,
                        edge_color="gray", opacity=1.0, name=name,
                    )
                else:
                    actor = self.plotter.add_mesh(
                        mesh, color="lightblue", show_edges=True,
                        edge_color="gray", opacity=1.0, name=name,
                    )
                self.view_actors[view][rk] = actor
                self.view_meshes[view][rk] = mesh

    def _remove_mesh_all_views(self, gv):
        """Remove all render meshes for a (group, variant) from all subplots."""
        for rk in self.gv_render_keys[gv]:
            for view in ALL_VIEWS:
                actor = self.view_actors[view].get(rk)
                if actor is not None:
                    self.plotter.subplot(*view)
                    self.plotter.remove_actor(actor)
                    self.view_actors[view][rk] = None
                    self.view_meshes[view][rk] = None

    def _update_gv(self, gv):
        """Update visibility for a (group, variant)."""
        if self.gv_visible[gv]:
            self._remove_mesh_all_views(gv)
            self._add_mesh_all_views(gv)
        else:
            self._remove_mesh_all_views(gv)

    def _is_group_visible(self, group):
        return any(self.gv_visible.get((group, v), False)
                   for v in self.group_variants[group])

    def _set_group_visible(self, group, state):
        for v in self.group_variants[group]:
            key = (group, v)
            self.gv_visible[key] = state
            self._update_gv(key)
        self.plotter.render()

    def _set_variant_visible(self, key, state):
        self.gv_visible[key] = state
        self._update_gv(key)
        self.plotter.render()

    def _close_popout(self):
        for w, label_name in self.variant_widgets:
            w.Off()
            rep = getattr(w, 'GetRepresentation', None)
            if rep is not None:
                rep().SetVisibility(0)
            try:
                self.plotter.remove_actor(label_name)
            except Exception:
                pass
        self.variant_widgets = []
        self.expanded_group = None

    def _open_popout(self, group, base_y):
        self._close_popout()
        self.expanded_group = group
        variants = self.group_variants[group]
        name = GEOSET_NAMES.get(group, f"Group {group}")
        popout_y = max(5, base_y - 5)

        self.plotter.subplot(*FRONT)

        header_name = "popout_header"
        self.plotter.add_text(
            f"  {name}", position=(COL2_X, popout_y + len(variants) * ROW_H),
            font_size=8, color="yellow", name=header_name,
        )
        self.variant_widgets.append(
            (type('Fake', (), {'Off': lambda s: None})(), header_name)
        )

        for i, v in enumerate(variants):
            key = (group, v)
            n_tri = sum(len(self.gv_faces[rk]) // 4 for rk in self.gv_render_keys[key])
            vlabel = f"v{v} ({n_tri} tri)"
            y = popout_y + (len(variants) - 1 - i) * ROW_H

            def make_cb(k):
                def cb(state):
                    self._set_variant_visible(k, state)
                return cb

            w = self.plotter.add_checkbox_button_widget(
                make_cb(key), value=self.gv_visible[key],
                position=(COL2_X, y), size=20,
                color_on="lightblue", color_off="grey",
            )
            lname = f"popout_v_{group}_{v}"
            self.plotter.add_text(
                vlabel, position=(COL2_X + 28, y + 2),
                font_size=7, color="white", name=lname,
            )
            self.variant_widgets.append((w, lname))

    def _make_expand_callback(self, group, y_pos):
        def callback(state):
            if state and self.expanded_group != group:
                self._open_popout(group, y_pos)
            else:
                self._close_popout()
        return callback

    def _make_group_callback(self, group):
        def callback(state):
            self._set_group_visible(group, state)
        return callback

    # --- Undo / Redo (separate stacks for motion and selection) ---

    def _capture_positions(self):
        """Snapshot positions of all ever-touched vertices."""
        return {idx: list(self.m2.vertices[idx].pos)
                for idx in self.original_positions}

    def _capture_selection(self):
        """Snapshot the current selection."""
        return list(self.selected)

    def _apply_positions(self, positions):
        """Restore vertex positions from a snapshot."""
        all_touched = set(positions.keys()) | set(self.original_positions.keys())
        changed = []
        for idx in all_touched:
            target = positions.get(idx, self.original_positions.get(idx))
            if target is None:
                continue
            cur = self.m2.vertices[idx].pos
            if cur[0] != target[0] or cur[1] != target[1] or cur[2] != target[2]:
                self.m2.vertices[idx].pos[:] = target
                self.points[idx] = target
                changed.append(idx)

        if changed:
            for view in ALL_VIEWS:
                for key, mesh in self.view_meshes[view].items():
                    if mesh is not None:
                        mesh.points[changed] = self.points[changed]
                        mesh.Modified()

        self._update_selection_display()
        if self.selected and self.selection_mode:
            self._update_widgets()
        self.plotter.render()

    def _apply_selection(self, selection):
        """Restore selection from a snapshot."""
        self.selected = list(selection)
        self._update_selection_display()
        if self.selected and self.selection_mode:
            self._update_widgets()
        elif self.widgets:
            self.plotter.clear_sphere_widgets()
            self.widgets.clear()
        self.plotter.render()

    def undo_motion(self):
        if not self.motion_undo:
            return
        self.motion_redo.append(self._capture_positions())
        self._apply_positions(self.motion_undo.pop())

    def redo_motion(self):
        if not self.motion_redo:
            return
        self.motion_undo.append(self._capture_positions())
        self._apply_positions(self.motion_redo.pop())

    def undo_selection(self):
        if not self.selection_undo:
            return
        self.selection_redo.append(self._capture_selection())
        self._apply_selection(self.selection_undo.pop())

    def redo_selection(self):
        if not self.selection_redo:
            return
        self.selection_undo.append(self._capture_selection())
        self._apply_selection(self.selection_redo.pop())

    def _capture_weights(self, indices):
        """Snapshot bone weights and indices for the given vertex indices."""
        snap = {}
        for vi in indices:
            v = self.m2.vertices[vi]
            snap[vi] = (list(v.bone_weights), list(v.bone_indices))
        return snap

    def _apply_weights(self, snapshot):
        """Restore bone weights from a snapshot."""
        for vi, (weights, indices) in snapshot.items():
            v = self.m2.vertices[vi]
            v.bone_weights[:] = weights
            v.bone_indices[:] = indices
        if self.bone_vis_mode:
            self._refresh_bone_colors()
        if self.anim_preview:
            self._apply_anim_frame()
        self.plotter.render()

    def undo_weights(self):
        if not self.weight_undo:
            return
        before, after = self.weight_undo.pop()
        self.weight_redo.append((before, after))
        self._apply_weights(before)

    def redo_weights(self):
        if not self.weight_redo:
            return
        before, after = self.weight_redo.pop()
        self.weight_undo.append((before, after))
        self._apply_weights(after)

    # --- Save ---

    def _edited_indices(self):
        """Return the set of vertex indices that have been moved."""
        edited = set()
        for i, old_pos in self.original_positions.items():
            cur = self.m2.vertices[i].pos
            if old_pos[0] != cur[0] or old_pos[1] != cur[1] or old_pos[2] != cur[2]:
                edited.add(i)
        return edited or None

    def save(self):
        """Save M2 to disk."""
        edited = self._edited_indices()
        save_m2(self.m2, self.save_path, edited_indices=edited)
        print(f"Saved to {self.save_path}")

    def save_as(self):
        """Open a file dialog and save M2 to the chosen path."""
        root = tk.Tk()
        root.withdraw()
        path = filedialog.asksaveasfilename(
            title="Save M2 As",
            defaultextension=".m2",
            filetypes=[("M2 Model", "*.m2"), ("All files", "*.*")],
            initialfile=self.m2.path.name,
        )
        root.destroy()
        if path:
            self.save_path = path
            edited = self._edited_indices()
            save_m2(self.m2, path, edited_indices=edited)
            print(f"Saved to {path}")

    # --- Keybindings ---

    def _setup_keybindings(self):
        iren = self.plotter.iren.interactor
        self._key_handled = False
        # Our handler fires first on KeyPressEvent and sets _key_handled.
        # It also clears the key sym so VTK's downstream handlers see nothing.
        iren.AddObserver('KeyPressEvent', self._on_key_press)
        # Block VTK's OnChar (handles printable keys like W=wireframe)
        style = iren.GetInteractorStyle()
        style.AddObserver('CharEvent', self._on_char)

    def _on_char(self, caller, event):
        """Block VTK's OnChar for keys we already handled."""
        if self._key_handled:
            return
        caller.OnChar()

    def _on_key_press(self, caller, event):
        key = caller.GetKeySym()
        ctrl = caller.GetControlKey()
        shift = caller.GetShiftKey()
        self._key_handled = True
        if ctrl and key.lower() == 'z' and not shift:
            if self.bone_vis_mode:
                self.undo_weights()
            else:
                self.undo_motion()
        elif ctrl and key.lower() == 'z' and shift:
            if self.bone_vis_mode:
                self.redo_weights()
            else:
                self.redo_motion()
        elif ctrl and key.lower() == 'a' and not shift:
            self.undo_selection()
        elif ctrl and key.lower() == 'a' and shift:
            self.redo_selection()
        elif ctrl and shift and key.lower() == 's':
            self.save_as()
        elif ctrl and key.lower() == 's':
            self.save()
        elif key.lower() == 'g':
            self.toggle_selection_mode()
        elif key.lower() == 'm' and not ctrl:
            self.mirror_selection()
        elif key.lower() == 'a' and not ctrl and not shift:
            self.cycle_animation()
        elif key.lower() == 'p' and not ctrl:
            self.toggle_anim_preview()
        elif key == 'Right':
            self.anim_step_forward()
        elif key == 'Left':
            self.anim_step_backward()
        elif key.lower() == 'b' and not ctrl:
            self.toggle_bone_vis()
        elif key == 'Up':
            self.next_bone()
        elif key == 'Down':
            self.prev_bone()
        elif key.lower() == 'w' and not ctrl:
            self.edit_bone_weight(increase=not shift)
        elif key.lower() == 's' and not ctrl:
            if shift:
                self.scale_selection(1.0 / 1.05)  # Shift+S: shrink
            else:
                self.scale_selection(1.05)          # S: expand
        else:
            self._key_handled = False
        # Wipe the key sym so VTK's downstream style handlers (which process
        # arrow keys for zoom/dolly outside of CharEvent) see nothing.
        if self._key_handled:
            caller.SetKeySym('')
            caller.SetKeyCode('\0')

    def toggle_selection_mode(self):
        self.selection_mode = not self.selection_mode
        n_cols = 2
        free_idx = FREE[0] * n_cols + FREE[1]
        if self.selection_mode:
            # Lock Free view camera (snapshot current angle)
            cam = self.plotter.renderers[free_idx].GetActiveCamera()
            self._locked_cams[free_idx] = {
                'pos': cam.GetPosition(),
                'focal': cam.GetFocalPoint(),
                'up': cam.GetViewUp(),
            }
            # Restore widgets if there's an active selection
            if self.selected:
                self._update_widgets()
        else:
            # Unlock Free view camera for rotation
            self._locked_cams.pop(free_idx, None)
            # Hide widgets so they don't interfere with camera
            if self.widgets:
                self.plotter.clear_sphere_widgets()
                self.widgets.clear()
        self._update_mode_label()
        self.plotter.render()

    def _update_mode_label(self):
        mode = "SELECT" if self.selection_mode else "CAMERA"
        color = "lime" if self.selection_mode else "cyan"
        for view in ALL_VIEWS:
            self.plotter.subplot(*view)
            self.plotter.add_text(
                f"[G] {mode}  [M] Mirror  [S/^S] Scale  [B] Bones  [^Z/^A] Undo",
                position="upper_left",
                font_size=9, color=color,
                name=f"modelabel_{view[0]}{view[1]}",
            )

    # --- Mouse handling ---

    def _setup_mouse_handling(self):
        iren = self.plotter.iren.interactor
        iren.AddObserver('LeftButtonPressEvent', self._on_left_down)
        iren.AddObserver('LeftButtonReleaseEvent', self._on_left_up)
        iren.AddObserver('MouseMoveEvent', self._on_mouse_move)
        iren.AddObserver('RightButtonPressEvent', self._on_right_down)

    def _renderer_at_pos(self, x, y):
        """Find which view and renderer the display-space position (x, y) is in."""
        ren_win = self.plotter.iren.interactor.GetRenderWindow()
        w, h = ren_win.GetSize()
        for view in ALL_VIEWS:
            idx = view[0] * 2 + view[1]
            renderer = self.plotter.renderers[idx]
            vp = renderer.GetViewport()
            if vp[0]*w <= x <= vp[2]*w and vp[1]*h <= y <= vp[3]*h:
                return view, renderer
        return None, None

    def _reset_box_state(self):
        """Clear all rubber-band / box-select tracking state."""
        self._clear_rubber_band()
        self._box_start = None
        self._box_press_time = 0
        self._box_renderer = None
        self._box_view = None
        self._box_dragging = False

    def _on_left_down(self, caller, event):
        if not self.selection_mode or self._in_pick:
            return

        x, y = caller.GetEventPosition()
        shift = bool(caller.GetShiftKey())

        # If a drag is active (rubber band visible) from a missed release,
        # finalize it now — "click to end the box".
        if self._box_dragging and self._box_start is not None:
            sx, sy = self._box_start
            renderer = self._box_renderer
            self._reset_box_state()
            self._in_pick = True
            try:
                self._box_select(renderer, sx, sy, x, y, shift)
            finally:
                self._in_pick = False
            return

        # Clear any non-drag stale state (previous click whose release was lost)
        self._reset_box_state()
        self._widget_dragging = False

        view, renderer = self._renderer_at_pos(x, y)
        if view is None:
            return
        self._box_start = (x, y)
        self._box_press_time = time.monotonic()
        self._box_renderer = renderer
        self._box_view = view

    def _on_mouse_move(self, caller, event):
        if not self.selection_mode or self._box_start is None or self._widget_dragging or self._in_pick:
            return

        # Only promote to a drag once the mouse exceeds the distance threshold.
        # If the threshold hasn't been reached within BOX_DRAG_TIMEOUT, the
        # press was a click whose release was lost — discard it.
        if not self._box_dragging:
            if time.monotonic() - self._box_press_time > BOX_DRAG_TIMEOUT:
                self._reset_box_state()
                return
            x, y = caller.GetEventPosition()
            sx, sy = self._box_start
            if abs(x - sx) > BOX_DRAG_THRESHOLD or abs(y - sy) > BOX_DRAG_THRESHOLD:
                self._box_dragging = True
            else:
                return

        x, y = caller.GetEventPosition()
        sx, sy = self._box_start
        self._draw_rubber_band(self._box_renderer, sx, sy, x, y)
        self.plotter.render()

    def _on_left_up(self, caller, event):
        if not self.selection_mode or self._box_start is None or self._in_pick:
            return

        x, y = caller.GetEventPosition()
        sx, sy = self._box_start
        renderer = self._box_renderer
        was_dragging = self._box_dragging

        self._reset_box_state()

        if self._widget_dragging:
            return

        shift = bool(caller.GetShiftKey())

        self._in_pick = True
        try:
            if not was_dragging:
                self._point_pick(renderer, x, y, shift)
            else:
                self._box_select(renderer, sx, sy, x, y, shift)
        finally:
            self._in_pick = False

    def _on_right_down(self, caller, event):
        if not self.selection_mode or not self.selected:
            return
        x, y = caller.GetEventPosition()
        view, renderer = self._renderer_at_pos(x, y)
        if renderer is None:
            return
        self._deselect_at(renderer, x, y)

    # --- Rubber band drawing ---

    def _draw_rubber_band(self, renderer, x0, y0, x1, y1):
        self._clear_rubber_band()
        vp = renderer.GetViewport()
        ren_win = self.plotter.iren.interactor.GetRenderWindow()
        w, h = ren_win.GetSize()
        ox, oy = vp[0] * w, vp[1] * h

        pts = vtk.vtkPoints()
        for px, py in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]:
            pts.InsertNextPoint(px - ox, py - oy, 0)
        lines = vtk.vtkCellArray()
        for i in range(4):
            lines.InsertNextCell(2)
            lines.InsertCellPoint(i)
            lines.InsertCellPoint((i + 1) % 4)
        pd = vtk.vtkPolyData()
        pd.SetPoints(pts)
        pd.SetLines(lines)

        coord = vtk.vtkCoordinate()
        coord.SetCoordinateSystemToViewport()
        mapper = vtk.vtkPolyDataMapper2D()
        mapper.SetInputData(pd)
        mapper.SetTransformCoordinate(coord)
        actor = vtk.vtkActor2D()
        actor.SetMapper(mapper)
        actor.GetProperty().SetColor(1, 1, 0)
        actor.GetProperty().SetLineWidth(2)
        renderer.AddActor2D(actor)
        self._rb_actor = actor
        self._rb_renderer = renderer

    def _clear_rubber_band(self):
        if self._rb_actor is not None and self._rb_renderer is not None:
            self._rb_renderer.RemoveActor2D(self._rb_actor)
            self._rb_actor = None
            self._rb_renderer = None

    # --- Selection methods ---

    def _get_visible_verts(self):
        visible = set()
        tri = self.m2.skin.tri_indices
        for sm in self.m2.skin.submeshes:
            key = (sm.group, sm.variant)
            if self.gv_visible.get(key, False):
                for j in range(sm.index_start, sm.index_start + sm.index_count):
                    visible.add(tri[j])
        return visible

    def _point_pick(self, renderer, x, y, shift):
        """Pick nearest vertex to the click position."""
        picker = vtk.vtkCellPicker()
        picker.SetTolerance(0.025)
        picker.Pick(x, y, 0, renderer)
        pos = picker.GetPickPosition()
        if pos == (0, 0, 0) and picker.GetCellId() < 0:
            return

        visible = self._get_visible_verts()
        click = np.array(pos)
        display = self._display_points()
        dists = np.linalg.norm(display - click, axis=1)
        mask = np.full(len(self.points), np.inf)
        for vi in visible:
            mask[vi] = dists[vi]

        nearest = int(np.argmin(mask))
        if mask[nearest] > 0.5:
            return

        new_pick = [nearest]
        nearby = np.where(mask < SELECTION_RADIUS)[0]
        if len(nearby) > 1:
            new_pick = nearby.tolist()

        self._apply_pick(new_pick, shift)

    def _box_select(self, renderer, x0, y0, x1, y1, shift):
        """Select all visible vertices whose screen projection falls within the box."""
        visible = self._get_visible_verts()
        if not visible:
            return

        # Normalize box bounds
        bx0, bx1 = min(x0, x1), max(x0, x1)
        by0, by1 = min(y0, y1), max(y0, y1)

        display = self._display_points()
        new_pick = []
        for vi in visible:
            pt = display[vi]
            renderer.SetWorldPoint(float(pt[0]), float(pt[1]), float(pt[2]), 1.0)
            renderer.WorldToDisplay()
            dx, dy, _ = renderer.GetDisplayPoint()
            if bx0 <= dx <= bx1 and by0 <= dy <= by1:
                new_pick.append(vi)

        if new_pick:
            self._apply_pick(new_pick, shift)

    def _apply_pick(self, new_pick, shift):
        """Apply a pick result to the selection (with shift-add support)."""
        self.selection_undo.append(self._capture_selection())
        self.selection_redo.clear()

        if shift and self.selected:
            existing = set(self.selected)
            for i in new_pick:
                if i not in existing:
                    self.selected.append(i)
        else:
            self.selected = new_pick

        for i in self.selected:
            if i not in self.original_positions:
                self.original_positions[i] = list(self.m2.vertices[i].pos)

        self._update_selection_display()
        self._update_widgets()

    def _deselect_at(self, renderer, x, y):
        """Right-click: remove the vertex nearest to click from selection."""
        picker = vtk.vtkCellPicker()
        picker.SetTolerance(0.025)
        picker.Pick(x, y, 0, renderer)
        pos = picker.GetPickPosition()
        if pos == (0, 0, 0) and picker.GetCellId() < 0:
            return

        click = np.array(pos)
        display = self._display_points()
        sel_set = set(self.selected)
        best_idx = None
        best_dist = float('inf')
        for vi in sel_set:
            d = np.linalg.norm(display[vi] - click)
            if d < best_dist:
                best_dist = d
                best_idx = vi
        if best_idx is None or best_dist > 0.5:
            return

        # Also deselect nearby vertices (same radius as selection)
        to_remove = {best_idx}
        for vi in sel_set:
            if np.linalg.norm(display[vi] - display[best_idx]) < DESELECTION_RADIUS:
                to_remove.add(vi)

        self.selection_undo.append(self._capture_selection())
        self.selection_redo.clear()
        self.selected = [i for i in self.selected if i not in to_remove]
        self._update_selection_display()
        if self.selected:
            self._update_widgets()
        else:
            if self.widgets:
                self.plotter.clear_sphere_widgets()
                self.widgets.clear()
        self.plotter.render()

    def scale_selection(self, factor):
        """Scale selected vertices from their centroid by the given factor."""
        if not self.selected or not self.selection_mode:
            return
        self.motion_undo.append(self._capture_positions())
        self.motion_redo.clear()

        center = self.points[self.selected].mean(axis=0)
        for i in self.selected:
            v = self.m2.vertices[i]
            v.pos[0] = center[0] + (v.pos[0] - center[0]) * factor
            v.pos[1] = center[1] + (v.pos[1] - center[1]) * factor
            v.pos[2] = center[2] + (v.pos[2] - center[2]) * factor

        self.update_mesh_points()
        self._update_selection_display()
        if self.widgets:
            self._update_widgets()

    # --- Mirror tool ---

    def _build_mirror_map(self):
        """Pre-compute vertex mirror pairs from the original mesh positions.

        For each vertex, find the closest vertex to its Y-flipped position.
        Returns dict mapping vertex index -> its mirror counterpart index.
        """
        pts = self.points  # original positions at load time
        mirrored = pts.copy()
        mirrored[:, 1] *= -1

        mirror_map = {}
        for i in range(len(pts)):
            dists = np.sum((pts - mirrored[i]) ** 2, axis=1)
            j = int(np.argmin(dists))
            if dists[j] < 0.05 * 0.05 and j != i:
                mirror_map[i] = j
        return mirror_map

    def mirror_selection(self):
        """Mirror selected vertices onto their Y-axis counterparts."""
        if not self.selected or not self.selection_mode:
            return

        # Find counterparts for selected vertices
        pairs = []  # (source, dest)
        sel_set = set(self.selected)
        for vi in self.selected:
            ci = self._mirror_map.get(vi)
            if ci is not None and ci not in sel_set:
                pairs.append((vi, ci))

        if not pairs:
            print("No mirror counterparts found outside the selection.")
            return

        # Track originals for undo
        for _, dst in pairs:
            if dst not in self.original_positions:
                self.original_positions[dst] = list(self.m2.vertices[dst].pos)
        self.motion_undo.append(self._capture_positions())
        self.motion_redo.clear()

        # Apply: set each counterpart to the Y-flipped position of the source
        moved = []
        for src_vi, dst_vi in pairs:
            src_pos = self.m2.vertices[src_vi].pos
            mirrored = [src_pos[0], -src_pos[1], src_pos[2]]
            self.m2.vertices[dst_vi].pos[:] = mirrored
            self.points[dst_vi] = mirrored
            moved.append(dst_vi)

        # Update meshes
        moved_arr = np.array(moved)
        for view in ALL_VIEWS:
            for key, mesh in self.view_meshes[view].items():
                if mesh is not None:
                    mesh.points[moved_arr] = self.points[moved_arr]
                    mesh.Modified()

        self._update_selection_display()
        self.plotter.render()
        print(f"Mirrored {len(pairs)} vertices across Y=0.")

    # --- Animation preview ---

    def toggle_anim_preview(self):
        """Toggle between rest pose and animation preview (P key)."""
        self.anim_preview = not self.anim_preview
        if self.anim_preview:
            self._apply_anim_frame()
        else:
            self._restore_rest_pose()
        self._update_anim_label()
        self.plotter.render()

    def cycle_animation(self):
        """Cycle to the next animation (A key)."""
        if not self.m2.animations:
            return
        self.anim_index = (self.anim_index + 1) % len(self.m2.animations)
        self.anim_time_ms = 0
        if self.anim_preview:
            self._apply_anim_frame()
        self._update_anim_label()
        self.plotter.render()

    def anim_step_forward(self):
        """Step animation forward by one frame (Right arrow)."""
        if not self.m2.animations:
            return
        anim = self.m2.animations[self.anim_index]
        self.anim_time_ms = (self.anim_time_ms + self.anim_step_ms) % max(anim.duration, 1)
        if self.anim_preview:
            self._apply_anim_frame()
        self._update_anim_label()
        self.plotter.render()

    def anim_step_backward(self):
        """Step animation backward by one frame (Left arrow)."""
        if not self.m2.animations:
            return
        anim = self.m2.animations[self.anim_index]
        dur = max(anim.duration, 1)
        self.anim_time_ms = (self.anim_time_ms - self.anim_step_ms) % dur
        if self.anim_preview:
            self._apply_anim_frame()
        self._update_anim_label()
        self.plotter.render()

    def _apply_anim_frame(self):
        """Compute deformed positions and update all meshes."""
        deformed = compute_deformed_positions(self.m2, self.anim_index,
                                              self.anim_time_ms)
        deformed = deformed.astype(np.float32)
        self._deformed_points = deformed
        for view in ALL_VIEWS:
            for key, mesh in self.view_meshes[view].items():
                if mesh is not None:
                    mesh.points[:] = deformed
                    mesh.Modified()
        # Update selection display if active
        if self.selected:
            self._update_selection_display()

    def _restore_rest_pose(self):
        """Restore base vertex positions in all meshes."""
        self._deformed_points = None
        for view in ALL_VIEWS:
            for key, mesh in self.view_meshes[view].items():
                if mesh is not None:
                    mesh.points[:] = self.points
                    mesh.Modified()
        if self.selected:
            self._update_selection_display()

    def _update_anim_label(self):
        """Update animation info text in all views."""
        if not self.m2.animations:
            return
        anim = self.m2.animations[self.anim_index]
        state = "ON" if self.anim_preview else "OFF"
        text = (f"[A] Anim: {anim.name} ({self.anim_index}/{len(self.m2.animations)})  "
                f"[</>] {self.anim_time_ms}ms/{anim.duration}ms  "
                f"[P] Preview: {state}")
        for view in ALL_VIEWS:
            self.plotter.subplot(*view)
            self.plotter.add_text(
                text, position="lower_left",
                font_size=8, color="orange",
                name=f"animlabel_{view[0]}{view[1]}",
            )

    # --- Bone weight visualization & editing ---

    def toggle_bone_vis(self):
        """Toggle bone weight visualization mode (B key)."""
        self.bone_vis_mode = not self.bone_vis_mode
        if self.bone_vis_mode:
            self._apply_bone_colors()
        else:
            self._clear_bone_colors()
        self._update_bone_label()
        self.plotter.render()

    def next_bone(self):
        """Select next bone for visualization (Up arrow in bone mode)."""
        if not self.m2.bones:
            return
        self.bone_vis_index = (self.bone_vis_index + 1) % len(self.m2.bones)
        if self.bone_vis_mode:
            self._apply_bone_colors()
        self._update_bone_label()
        self.plotter.render()

    def prev_bone(self):
        """Select previous bone for visualization (Down arrow in bone mode)."""
        if not self.m2.bones:
            return
        self.bone_vis_index = (self.bone_vis_index - 1) % len(self.m2.bones)
        if self.bone_vis_mode:
            self._apply_bone_colors()
        self._update_bone_label()
        self.plotter.render()

    def _compute_bone_weights_array(self, bone_index):
        """Get per-vertex weight for a specific bone as float array (0..1)."""
        n = len(self.m2.vertices)
        weights = np.zeros(n, dtype=np.float32)
        for i, v in enumerate(self.m2.vertices):
            for j in range(4):
                if v.bone_indices[j] == bone_index and v.bone_weights[j] > 0:
                    weights[i] = v.bone_weights[j] / 255.0
        return weights

    def _apply_bone_colors(self):
        """Color all meshes by weight for the selected bone (red=1, blue=0).

        Rebuilds actors with scalar coloring. Use _refresh_bone_colors() for
        lightweight updates after weight edits.
        """
        weights = self._compute_bone_weights_array(self.bone_vis_index)
        for view in ALL_VIEWS:
            for key, mesh in self.view_meshes[view].items():
                if mesh is not None:
                    mesh['bone_weight'] = weights
                    mesh.set_active_scalars('bone_weight')
            # Remove existing actor and re-add with scalar coloring
            for key in list(self.view_actors[view].keys()):
                actor = self.view_actors[view].get(key)
                if actor is not None:
                    self.plotter.subplot(*view)
                    self.plotter.remove_actor(actor)
                    mesh = self.view_meshes[view][key]
                    if mesh is not None:
                        actor = self.plotter.add_mesh(
                            mesh, scalars='bone_weight', cmap='coolwarm',
                            clim=[0, 1], show_edges=True, edge_color="gray",
                            show_scalar_bar=False,
                            name=f"gv_{key[0]}_{key[1]}_{key[2]}_{view[0]}{view[1]}",
                        )
                        self.view_actors[view][key] = actor

    def _refresh_bone_colors(self):
        """Lightweight update of bone weight scalars on existing meshes."""
        weights = self._compute_bone_weights_array(self.bone_vis_index)
        for view in ALL_VIEWS:
            for key, mesh in self.view_meshes[view].items():
                if mesh is not None:
                    mesh['bone_weight'] = weights
                    mesh.Modified()

    def _clear_bone_colors(self):
        """Restore normal mesh appearance (remove bone weight coloring)."""
        for gv in list(self.gv_render_keys.keys()):
            if self.gv_visible.get(gv, False):
                self._remove_mesh_all_views(gv)
                self._add_mesh_all_views(gv)

    def edit_bone_weight(self, increase=True):
        """Adjust bone weight on selected vertices for the current bone (W/Shift+W).

        Increases or decreases the weight for bone_vis_index on all selected
        vertices. Other weights are scaled proportionally to maintain sum=255.
        """
        if not self.selected:
            print("No vertices selected for weight editing.")
            return

        bi = self.bone_vis_index
        delta = self.weight_edit_delta if increase else -self.weight_edit_delta

        # Snapshot weights before editing for undo
        before = self._capture_weights(self.selected)
        changed_indices = set()

        for vi in self.selected:
            v = self.m2.vertices[vi]

            # Find if this bone already has a slot
            slot = -1
            for j in range(4):
                if v.bone_indices[j] == bi:
                    slot = j
                    break

            if slot == -1 and increase:
                # Need a free slot or replace the smallest weight
                # Find the slot with smallest weight
                min_j, min_w = 0, v.bone_weights[0]
                for j in range(1, 4):
                    if v.bone_weights[j] < min_w:
                        min_j, min_w = j, v.bone_weights[j]
                slot = min_j
                v.bone_indices[slot] = bi
                v.bone_weights[slot] = 0
            elif slot == -1:
                # Decreasing a bone that isn't assigned — skip
                continue

            # Adjust weight
            old_w = v.bone_weights[slot]
            new_w = max(0, min(255, old_w + delta))

            if new_w == old_w:
                continue

            # Can't decrease if no other bones to absorb the weight
            other_sum = sum(v.bone_weights[j] for j in range(4) if j != slot)
            if other_sum == 0 and not increase:
                continue

            v.bone_weights[slot] = new_w
            changed_indices.add(vi)

            # Normalize: distribute remaining weight among other bones
            remaining = 255 - new_w
            if other_sum > 0:
                scale = remaining / other_sum
                for j in range(4):
                    if j != slot:
                        v.bone_weights[j] = int(round(v.bone_weights[j] * scale))

            # Fix rounding to ensure sum = 255 — apply to largest weight,
            # not the edited slot, to avoid oscillation at small values
            total = sum(v.bone_weights)
            diff = 255 - total
            if diff != 0:
                fix_slot = max(range(4), key=lambda j: v.bone_weights[j])
                v.bone_weights[fix_slot] = max(0, v.bone_weights[fix_slot] + diff)

            # Remove zero-weight bones (set their index to 0)
            for j in range(4):
                if v.bone_weights[j] == 0 and j != slot:
                    v.bone_indices[j] = 0

        if changed_indices:
            after = self._capture_weights(changed_indices)
            # Only store before-state for vertices that actually changed
            before_changed = {vi: before[vi] for vi in changed_indices}
            self.weight_undo.append((before_changed, after))
            self.weight_redo.clear()
            if self.bone_vis_mode:
                self._refresh_bone_colors()
            if self.anim_preview:
                self._apply_anim_frame()
            self.plotter.render()
            for vi in changed_indices:
                v = self.m2.vertices[vi]
                print(f"  v{vi}: weights={list(v.bone_weights)} bones={list(v.bone_indices)}")

    def _update_bone_label(self):
        """Update bone visualization info text."""
        if not self.m2.bones:
            return
        bone = self.m2.bones[self.bone_vis_index]
        state = "ON" if self.bone_vis_mode else "OFF"
        key_str = f"key={bone.key_bone_id}" if bone.key_bone_id >= 0 else "no key"
        parent_str = f"parent={bone.parent}" if bone.parent >= 0 else "root"
        text = (f"[B] Bone: {self.bone_vis_index}/{len(self.m2.bones)} "
                f"({key_str}, {parent_str})  "
                f"[Up/Down] Select  [W/^W] Edit  Vis: {state}")
        for view in ALL_VIEWS:
            self.plotter.subplot(*view)
            self.plotter.add_text(
                text, position="lower_right",
                font_size=8, color="magenta",
                name=f"bonelabel_{view[0]}{view[1]}",
            )

    def update_mesh_points(self):
        """Update vertex positions in-place across all views."""
        for i in self.selected:
            self.points[i] = self.m2.vertices[i].pos
        # When animation preview is active, show deformed positions in the mesh
        # (self.points always tracks rest-pose for editing purposes)
        display = self._display_points()
        for view in ALL_VIEWS:
            for key, mesh in self.view_meshes[view].items():
                if mesh is not None:
                    mesh.points[self.selected] = display[self.selected]
                    mesh.Modified()
        self.plotter.render()

    def _compute_widget_pos(self):
        """Compute a widget position offset outward from the mesh surface."""
        sel_pts = self.points[self.selected]
        center = sel_pts.mean(axis=0)

        # Average normal of selected vertices to push widget outward
        normals = np.array([self.m2.vertices[i].normal for i in self.selected])
        avg_normal = normals.mean(axis=0)
        length = np.linalg.norm(avg_normal)
        if length > 1e-6:
            avg_normal /= length
        else:
            # Normals cancel out — offset away from model center instead
            outward = center - np.array(MODEL_CENTER, dtype=np.float32)
            length = np.linalg.norm(outward)
            avg_normal = outward / length if length > 1e-6 else np.array([0, 0, 1.0])

        return center + avg_normal * WIDGET_OFFSET

    def _update_widgets(self):
        """Place sphere widgets outside the mesh at the current selection."""
        widget_pos = self._compute_widget_pos()
        self._widget_center = widget_pos.copy()
        if self.widgets:
            self.plotter.clear_sphere_widgets()
            self.widgets.clear()
        for view in ALL_VIEWS:
            self.plotter.subplot(*view)
            w = self.plotter.add_sphere_widget(
                self._make_widget_callback(view),
                center=widget_pos,
                radius=WIDGET_RADIUS,
                color="red",
                style="wireframe",
            )
            self.widgets[view] = w

    def _make_widget_callback(self, source_view):
        def callback(new_center):
            # Snapshot positions on first drag movement
            if not self._widget_dragging:
                self.motion_undo.append(self._capture_positions())
                self.motion_redo.clear()
            self._widget_dragging = True
            if self._syncing_widgets or not self.selected:
                return
            self._syncing_widgets = True

            # Delta from widget's own previous position, not vertex centroid,
            # so the normal offset doesn't cause a jump on first drag.
            delta = np.array(new_center) - self._widget_center
            self._widget_center = np.array(new_center)
            for i in self.selected:
                self.m2.vertices[i].pos[0] += delta[0]
                self.m2.vertices[i].pos[1] += delta[1]
                self.m2.vertices[i].pos[2] += delta[2]
            self.update_mesh_points()
            self._update_selection_display()

            # Sync widget positions in other views
            for view, w in self.widgets.items():
                if view != source_view and w is not None:
                    w.SetCenter(new_center)

            self._syncing_widgets = False
        return callback

    def _display_points(self):
        """Return the vertex positions currently shown (deformed or rest)."""
        if self._deformed_points is not None:
            return self._deformed_points
        return self.points

    def _update_selection_display(self):
        """Show red selection dots in all 4 views."""
        display = self._display_points()
        sel_pts = display[self.selected] if self.selected else None
        for view in ALL_VIEWS:
            mesh = self.selection_meshes[view]
            # If selection count changed, we must recreate
            if mesh is not None and sel_pts is not None and len(mesh.points) == len(sel_pts):
                mesh.points = sel_pts.copy()
                mesh.Modified()
            else:
                # Remove old actor if any
                self.plotter.subplot(*view)
                actor = self.selection_actors[view]
                if actor is not None:
                    self.plotter.remove_actor(actor)
                    self.selection_actors[view] = None
                    self.selection_meshes[view] = None
                # Create new if we have a selection
                if sel_pts is not None:
                    sel_cloud = pv.PolyData(sel_pts.copy())
                    self.selection_actors[view] = self.plotter.add_mesh(
                        sel_cloud, color="red", point_size=12,
                        render_points_as_spheres=True,
                        name=f"sel_{view[0]}{view[1]}",
                    )
                    self.selection_meshes[view] = sel_cloud

    def run(self):
        # Set up all 4 views with meshes and cameras
        for view in ALL_VIEWS:
            self.plotter.subplot(*view)
            self.plotter.set_background("#1a1a1a")
            self.plotter.add_text(
                VIEW_LABELS[view], position="upper_right",
                font_size=10, color="yellow",
                name=f"viewlabel_{view[0]}{view[1]}",
            )

        # Add initial meshes to all views
        for gv in sorted(self.gv_render_keys.keys()):
            if self.gv_visible[gv]:
                self._add_mesh_all_views(gv)

        # Set preset cameras for fixed views + Free starts matching Front
        for view, cam in CAMERAS.items():
            self.plotter.subplot(*view)
            self.plotter.camera_position = cam
        self.plotter.subplot(*FREE)
        self.plotter.camera_position = CAMERAS[FRONT]

        # Sync zoom across all 4 views (must be after cameras are set)
        self._setup_zoom_sync()

        # Set up mesh toggles in Front view
        self.plotter.subplot(*FRONT)

        for i, g in enumerate(self.groups):
            name = GEOSET_NAMES.get(g, f"Group {g}")
            n_variants = len(self.group_variants[g])
            total_tri = sum(len(self.gv_faces[rk]) // 4
                           for v in self.group_variants[g]
                           for rk in self.gv_render_keys[(g, v)])
            y = 10 + i * ROW_H

            self.plotter.add_checkbox_button_widget(
                self._make_group_callback(g),
                value=self._is_group_visible(g),
                position=(COL1_X, y), size=22,
                color_on="lightblue", color_off="grey",
            )

            label = f"{name} ({total_tri} tri)"
            self.plotter.add_text(
                label, position=(COL1_X + 30, y + 2),
                font_size=7, color="white", name=f"glabel_{g}",
            )

            if n_variants > 1:
                self.plotter.add_checkbox_button_widget(
                    self._make_expand_callback(g, y),
                    value=False,
                    position=(COL1_X + 185, y), size=22,
                    color_on="yellow", color_off="#555555",
                )
                self.plotter.add_text(
                    "+", position=(COL1_X + 190, y + 2),
                    font_size=7, color="white", name=f"expand_{g}",
                )

        # Custom mouse handling for selection, box select, and right-click deselect
        self._setup_mouse_handling()

        # Starting in camera mode — Free view stays unlocked

        # Keybindings (Ctrl+Z, Ctrl+S, Ctrl+Shift+S, G, A, P, arrows, B, W)
        self._setup_keybindings()
        self._update_mode_label()
        self._update_anim_label()
        self._update_bone_label()

        self.plotter.show()
        return self._get_changes()

    def _get_changes(self):
        changes = []
        for i, old_pos in self.original_positions.items():
            new_pos = self.m2.vertices[i].pos
            if old_pos != new_pos:
                changes.append((i, old_pos, list(new_pos)))
        return changes


def main():
    if len(sys.argv) < 2:
        print("Usage: python viewer.py <model.m2>")
        print()
        print("Textures are resolved from BLP files next to the M2:")
        print("  Replaceable:  {ModelName}Skin00_XX.blp / _Extra.blp")
        print("  Hardcoded:    searched in M2 dir, then up parent dirs by embedded path")
        print()
        print("Examples:")
        print("  python viewer.py TaurenFemale.m2")
        print("  python viewer.py Character/Tauren/Female/TaurenFemale.m2")
        sys.exit(1)

    m2_path = sys.argv[1]

    print(f"Loading {m2_path}...")
    m2 = load_m2(m2_path)

    gv_tris = defaultdict(int)
    tri = m2.skin.tri_indices
    for sm in m2.skin.submeshes:
        gv_tris[(sm.group, sm.variant)] += sm.index_count // 3

    groups = sorted(set(k[0] for k in gv_tris))
    print(f"  {len(m2.vertices)} vertices, {len(tri)//3} triangles")
    if m2.textures:
        print(f"  Texture table ({len(m2.textures)} entries):")
        for i, tex in enumerate(m2.textures):
            tname = TEX_TYPE_NAMES.get(tex.type, f"Type{tex.type}")
            fname = f" -> {tex.filename}" if tex.filename else ""
            print(f"    [{i}] {tname}{fname}")
    print(f"  Geoset groups:")
    for g in groups:
        name = GEOSET_NAMES.get(g, f"Group {g}")
        variants = sorted(k[1] for k in gv_tris if k[0] == g)
        total = sum(gv_tris[(g, v)] for v in variants)
        vis = "*" if g in DEFAULT_VISIBLE else " "
        vstr = f" (variants: {', '.join(f'v{v}' for v in variants)})" if len(variants) > 1 else ""
        print(f"    [{vis}] {name}: {total} tri{vstr}")

    # Resolve BLP textures using wow_tools conventions
    texture_paths = _resolve_textures(m2, m2_path)
    if texture_paths:
        print(f"  Resolved {len(texture_paths)} texture(s)")
    else:
        print("  No textures found")
    print()

    viewer = M2Viewer(m2, texture_paths=texture_paths)
    viewer.run()


if __name__ == "__main__":
    main()

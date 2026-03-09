import * as THREE from 'three';
import { composeCharTexture, loadTexImageData, CharRegion } from './charTexture';

export interface BoneInfo {
  parent: number;
  pivot: [number, number, number];
  rotation: [number, number, number, number];
  translation: [number, number, number];
}

export interface LoadedModel {
  group: THREE.Group;
  bones: THREE.Bone[];
  boneData: BoneInfo[];
}

/** Equipment texture base paths for body armor compositing. No gender suffix, no .tex extension.
 *  Resolver tries _{gender}.tex → _U.tex → .tex, using the first that loads.
 *  Example: '/item-textures/ArmUpperTexture/Plate_A_01Silver_Sleeve_AU'
 */
export interface BodyArmor {
  armUpperBase?: string;
  armLowerBase?: string;
  handBase?: string;
  torsoUpperBase?: string;
  torsoLowerBase?: string;
  legUpperBase?: string;
  legLowerBase?: string;
  footBase?: string;
  /** GeosetGroup[0] value for gloves slot (group 4). 1=401, 2=402, 3=403. 0/undefined = default bare hands. */
  handGeoset?: number;
  /** GeosetGroup[0] value for boots slot (group 5). 1=501, 2=502, 3=503. 0/undefined = default bare feet. */
  footGeoset?: number;
  /** Sleeve geoset (group 8). 2→802 fitted, 3→803 armored. 0/undefined = no sleeve geometry. */
  sleeveGeoset?: number;
  /** Wrist geoset (group 9). 2→902 leather, 3→903 armored. 0/undefined = no wrist geometry. */
  wristGeoset?: number;
  /** Robe leg extension (group 13). 2→1302 robe skirt. 0/undefined = default thigh (1301). */
  robeGeoset?: number;
  /** Helmet model slug, e.g. 'helm-plate-d-02'. Race-gender variant resolved at load time. */
  helmet?: string;
  /** HelmetGeosetVisData IDs [male, female] — controls which geosets to hide. */
  helmetGeosetVisID?: [number, number];
  /** Helmet texture slug — used to pick textures/{slug}.tex instead of main.tex. */
  helmetTexture?: string;
  /** Shoulder model slug, e.g. 'leather-blood-b-01'. */
  shoulderSlug?: string;
  /** Whether the right shoulder model exists. */
  shoulderHasRight?: boolean;
  /** Shoulder texture slug — used to pick textures/{slug}.tex instead of main.tex. */
  shoulderTexture?: string;
}

interface AttachmentPoint {
  id: number;
  bone: number;
  pos: [number, number, number];
}

interface ModelManifest {
  vertexCount: number;
  indexCount: number;
  triangleCount: number;
  vertexBufferSize: number;
  indexBufferSize: number;
  vertexStride: number;
  bones: BoneInfo[];
  groups: Array<{ id: number; indexStart: number; indexCount: number; textureType: number }>;
  attachments?: AttachmentPoint[];
}

// Groups to enable for a naked character and which variant to prefer.
// WoW default: each group gets value=1 → meshId = group*100 + 1.
// If the preferred variant doesn't exist, fall back to the lowest available.
const DESIRED_GROUPS: Array<{ group: number; preferred: number; strict?: boolean }> = [
  { group: 1, preferred: 1 },   // facial 1 (face for goblins, facial hair for others)
  { group: 2, preferred: 1 },   // facial 2
  { group: 3, preferred: 1 },   // facial 3
  { group: 4, preferred: 1 },   // gloves (bare hands)
  { group: 5, preferred: 1 },   // boots (bare feet)
  { group: 7, preferred: 1 },   // ears
  { group: 13, preferred: 1 },  // trousers/legs (thigh geometry)
  { group: 15, preferred: 1, strict: true },  // bare back only; never show cape variants
];

function resolveDefaultGeosets(
  groups: Array<{ id: number }>,
  hairstyle: number = 5,
  groupOverrides?: Map<number, number>, // group → meshId (e.g. 8 → 802 for short sleeves)
  hiddenGroups?: Set<number>, // groups to completely hide (helmet vis)
): Set<number> {
  // Index available geosets by group
  const byGroup = new Map<number, number[]>();
  for (const g of groups) {
    const grp = Math.floor(g.id / 100);
    if (!byGroup.has(grp)) byGroup.set(grp, []);
    byGroup.get(grp)!.push(g.id);
  }

  const result = new Set<number>();
  result.add(0);           // body mesh (always)
  // Hair geoset — hide if helmet requires it (group 0 = hair)
  if (hiddenGroups?.has(0)) {
    // Enable bald head geoset (1) instead of hairstyle
    const available0 = byGroup.get(0);
    if (available0?.includes(1)) result.add(1);
  } else {
    result.add(hairstyle);
  }

  // Apply overrides first; track which groups are handled so DESIRED_GROUPS skips them
  const handledGroups = new Set<number>();
  if (groupOverrides) {
    for (const [grp, meshId] of groupOverrides) {
      const available = byGroup.get(grp);
      if (!available || available.length === 0) continue;
      handledGroups.add(grp);
      // Use requested meshId if available; otherwise fall back to highest in group
      result.add(available.includes(meshId) ? meshId : Math.max(...available));
    }
  }

  for (const { group, preferred, strict } of DESIRED_GROUPS) {
    if (handledGroups.has(group)) continue; // override already handled this group
    if (hiddenGroups?.has(group)) continue; // helmet vis hides this group entirely
    const available = byGroup.get(group);
    if (!available || available.length === 0) continue;
    const target = group * 100 + preferred;
    if (available.includes(target)) {
      result.add(target);
    } else if (!strict) {
      result.add(Math.min(...available));
    }
  }

  return result;
}

async function loadTexture(url: string): Promise<THREE.DataTexture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const headerView = new DataView(buf, 0, 4);
  const width = headerView.getUint16(0, true);
  const height = headerView.getUint16(2, true);
  const pixels = new Uint8Array(buf, 4);

  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = false;
  return texture;
}

// M2 texture types: 0=Hardcoded, 1=Body/skin, 2=Cape, 6=Hair, 8=Fur
const HAIR_TEX_TYPE = 6;

// Fallback for legacy model.json without textureType: geoset IDs that use hair texture
const HAIR_GEOSETS_FALLBACK = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

// Facial hair geoset groups (1, 2, 3) whose unresolved submeshes should use hair texture.
// The M2 texture lookup chain is broken in our converter (v256 format quirk), so
// submeshes that should map to hair texture (type 6) get textureType=-1 instead.
// When textureType is unresolved (-1) and the geoset is in groups 1-3, use hair.
function isFacialHairGeoset(geosetId: number): boolean {
  const group = Math.floor(geosetId / 100);
  return group >= 1 && group <= 3;
}

// --- Race-gender maps for helmet/shoulder loading ---

const RACE_ID_MAP: Record<string, number> = {
  'human': 1, 'orc': 2, 'dwarf': 3, 'night-elf': 4,
  'scourge': 5, 'tauren': 6, 'gnome': 7, 'troll': 8,
  'goblin': 9, 'blood-elf': 10,
};

// HelmetGeosetVisData field index → geoset group and "hide" value
// [0]=Hair(group 0)→1(bald), [1]=Facial1(group 1)→101, [2]=Facial2(group 2)→201,
// [3]=Facial3(group 3)→301, [4]=Ears(group 7)→701
const HELMET_VIS_GROUPS: Array<{ group: number; hideValue: number }> = [
  { group: 0, hideValue: 1 },    // Hair → bald (geoset 1)
  { group: 1, hideValue: 101 },  // Facial1
  { group: 2, hideValue: 201 },  // Facial2
  { group: 3, hideValue: 301 },  // Facial3
  { group: 7, hideValue: 701 },  // Ears
];

interface HelmetVisRecord {
  ID: number;
  HideGeoset: number[];
}

let helmetVisDataCache: HelmetVisRecord[] | null = null;

async function loadHelmetVisData(): Promise<HelmetVisRecord[]> {
  if (helmetVisDataCache) return helmetVisDataCache;
  try {
    const res = await fetch('/data/HelmetGeosetVisData.json');
    helmetVisDataCache = await res.json();
  } catch {
    helmetVisDataCache = [];
  }
  return helmetVisDataCache!;
}

// --- Skeleton builder ---

function buildSkeleton(boneData: BoneInfo[]): { skeleton: THREE.Skeleton; roots: THREE.Bone[] } {
  const bones: THREE.Bone[] = boneData.map(() => new THREE.Bone());
  const roots: THREE.Bone[] = [];

  // Set up parent hierarchy and collect roots
  for (let i = 0; i < boneData.length; i++) {
    const p = boneData[i].parent;
    if (p >= 0 && p < bones.length) {
      bones[p].add(bones[i]);
    } else {
      roots.push(bones[i]);
    }
  }

  // Set LOCAL bone matrix: T(pivot + trans) * R(rot) * T(-pivot)
  // Three.js will compute matrixWorld = parent.matrixWorld * bone.matrix
  for (let i = 0; i < boneData.length; i++) {
    const b = boneData[i];
    bones[i].matrixAutoUpdate = false;

    const negPivot = new THREE.Matrix4().makeTranslation(-b.pivot[0], -b.pivot[1], -b.pivot[2]);
    const rot = new THREE.Matrix4().makeRotationFromQuaternion(
      new THREE.Quaternion(b.rotation[0], b.rotation[1], b.rotation[2], b.rotation[3]),
    );
    const posPivot = new THREE.Matrix4().makeTranslation(
      b.pivot[0] + b.translation[0],
      b.pivot[1] + b.translation[1],
      b.pivot[2] + b.translation[2],
    );

    const local = new THREE.Matrix4();
    local.copy(posPivot).multiply(rot).multiply(negPivot);
    bones[i].matrix.copy(local);
  }

  // boneInverses = identity (M2 bind pose is identity)
  const boneInverses = boneData.map(() => new THREE.Matrix4());
  const skeleton = new THREE.Skeleton(bones, boneInverses);

  return { skeleton, roots };
}

/**
 * Load a static item model (weapon, shoulder, etc.) from a public/items/ directory.
 * Returns a plain THREE.Group (no skeleton needed — item vertices are in bind pose).
 */
async function loadItemModel(
  itemDir: string,
  textureUrl?: string,
): Promise<THREE.Group> {
  interface ItemManifest {
    vertexCount: number;
    indexCount: number;
    vertexBufferSize: number;
    indexBufferSize: number;
    vertexStride: number;
  }

  const [manifest, binBuf, texture] = await Promise.all([
    fetch(`${itemDir}/model.json`).then(r => r.json()) as Promise<ItemManifest>,
    fetch(`${itemDir}/model.bin`).then(r => r.arrayBuffer()),
    loadTexture(textureUrl ?? `${itemDir}/textures/main.tex`),
  ]);

  const STRIDE = manifest.vertexStride; // 32
  const STRIDE_F32 = STRIDE / 4;        // 8
  const vCount = manifest.vertexCount;
  const rawF32 = new Float32Array(binBuf, 0, manifest.vertexBufferSize / 4);

  const positions = new Float32Array(vCount * 3);
  const normals   = new Float32Array(vCount * 3);
  const uvs       = new Float32Array(vCount * 2);

  for (let i = 0; i < vCount; i++) {
    const f = i * STRIDE_F32;
    positions[i * 3 + 0] = rawF32[f + 0];
    positions[i * 3 + 1] = rawF32[f + 1];
    positions[i * 3 + 2] = rawF32[f + 2];
    normals[i * 3 + 0]   = rawF32[f + 3];
    normals[i * 3 + 1]   = rawF32[f + 4];
    normals[i * 3 + 2]   = rawF32[f + 5];
    uvs[i * 2 + 0]       = rawF32[f + 6];
    uvs[i * 2 + 1]       = rawF32[f + 7];
  }

  const indices = new Uint16Array(binBuf, manifest.vertexBufferSize, manifest.indexCount);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal',   new THREE.BufferAttribute(normals, 3));
  geom.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));

  const mat = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geom, mat));
  return group;
}

/**
 * Load a character model from a directory.
 * @param modelDir - e.g. '/models/human-male' — loads model.json, model.bin, textures/skin.tex
 */
export async function loadModel(
  modelDir: string,
  options?: {
    enabledGeosets?: Set<number>;
    weapon?: string; // URL to item dir, e.g. '/items/weapon/sword-2h-claymore-b-02'
    weaponTexture?: string; // URL to weapon texture, e.g. '/items/weapon/{slug}/textures/{tex}.tex'
    offhand?: string; // URL to offhand item dir (weapon or shield)
    offhandTexture?: string; // URL to offhand texture
    armor?: BodyArmor;
  },
): Promise<LoadedModel> {
  const texturesDir = `${modelDir}/textures/`;

  const [manifestRes, binRes] = await Promise.all([
    fetch(`${modelDir}/model.json`),
    fetch(`${modelDir}/model.bin`),
  ]);

  const manifest: ModelManifest = await manifestRes.json();
  const binBuffer = await binRes.arrayBuffer();

  // Build geoset overrides from armor (boots swap group 5, gloves swap group 4)
  const armorGeoOverrides = new Map<number, number>();
  if (options?.armor?.handGeoset) armorGeoOverrides.set(4, 400 + options.armor.handGeoset);
  if (options?.armor?.footGeoset) armorGeoOverrides.set(5, 500 + options.armor.footGeoset);
  if (options?.armor?.sleeveGeoset) armorGeoOverrides.set(8, 800 + options.armor.sleeveGeoset);
  if (options?.armor?.wristGeoset) armorGeoOverrides.set(9, 900 + options.armor.wristGeoset);
  if (options?.armor?.robeGeoset) armorGeoOverrides.set(13, 1300 + options.armor.robeGeoset);

  // Helmet geoset visibility hiding — always hide hair when any helmet is equipped
  let helmetHiddenGroups: Set<number> | undefined;
  if (options?.armor?.helmet) {
    helmetHiddenGroups = new Set<number>();
    helmetHiddenGroups.add(0); // Always hide hair when helmet equipped

    // Apply HelmetGeosetVisData for additional hiding (facial hair, ears)
    if (options.armor.helmetGeosetVisID) {
      const modelSlug = modelDir.split('/').pop() || '';
      const raceSlug = modelSlug.replace(/-(?:male|female)$/, '');
      const genderIdx = modelSlug.endsWith('-female') ? 1 : 0;
      const raceId = RACE_ID_MAP[raceSlug];
      const visID = options.armor.helmetGeosetVisID[genderIdx];

      if (visID && raceId) {
        const visData = await loadHelmetVisData();
        const visRecord = visData.find(r => r.ID === visID);
        if (visRecord) {
          for (let i = 0; i < HELMET_VIS_GROUPS.length && i < visRecord.HideGeoset.length; i++) {
            const flag = visRecord.HideGeoset[i];
            if ((flag & (1 << raceId)) !== 0) {
              helmetHiddenGroups.add(HELMET_VIS_GROUPS[i].group);
            }
          }
        }
      }
    }
  }

  const geosets = options?.enabledGeosets ??
    resolveDefaultGeosets(
      manifest.groups, 5,
      armorGeoOverrides.size > 0 ? armorGeoOverrides : undefined,
      helmetHiddenGroups,
    );

  // Derive gender suffix from modelDir slug (e.g. '/models/human-female' → 'F')
  const genderSuffix = modelDir.includes('-female') ? 'F' : 'M';

  // Load skin texture — with equipment compositing when armor is provided
  let skinTexture: THREE.Texture;
  try {
    const armor = options?.armor;
    const hasArmor = armor && Object.values(armor).some(v => v);
    if (hasArmor) {
      const baseImageData = await loadTexImageData(`${texturesDir}skin.tex`);
      const layers: Array<{ imageData: ImageData; region: CharRegion; layer: number }> = [];

      // Try gender-specific suffix, then universal, then no suffix
      async function resolveEquipTex(base: string): Promise<ImageData | null> {
        for (const s of [genderSuffix, 'U', '']) {
          try {
            const url = s ? `${base}_${s}.tex` : `${base}.tex`;
            return await loadTexImageData(url);
          } catch { /* try next suffix */ }
        }
        return null;
      }

      async function tryAddLayer(base: string | undefined, region: CharRegion) {
        if (!base) return;
        const imageData = await resolveEquipTex(base);
        if (imageData) layers.push({ imageData, region, layer: 20 });
      }

      await tryAddLayer(armor.armUpperBase,   CharRegion.ARM_UPPER);
      await tryAddLayer(armor.armLowerBase,   CharRegion.ARM_LOWER);
      await tryAddLayer(armor.handBase,       CharRegion.HAND);
      await tryAddLayer(armor.torsoUpperBase, CharRegion.TORSO_UPPER);
      await tryAddLayer(armor.torsoLowerBase, CharRegion.TORSO_LOWER);
      await tryAddLayer(armor.legUpperBase,   CharRegion.LEG_UPPER);
      await tryAddLayer(armor.legLowerBase,   CharRegion.LEG_LOWER);
      await tryAddLayer(armor.footBase,       CharRegion.FOOT);

      const canvas = composeCharTexture(baseImageData, layers);
      // Read composited pixels back and upload as DataTexture (preserves flipY=false convention)
      const compositedPixels = new Uint8Array(
        canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.buffer,
      );
      skinTexture = new THREE.DataTexture(compositedPixels, canvas.width, canvas.height, THREE.RGBAFormat);
      skinTexture.needsUpdate = true;
      skinTexture.magFilter = THREE.LinearFilter;
      skinTexture.minFilter = THREE.LinearMipmapLinearFilter;
      skinTexture.generateMipmaps = true;
      skinTexture.wrapS = THREE.RepeatWrapping;
      skinTexture.wrapT = THREE.RepeatWrapping;
      skinTexture.flipY = false;
    } else {
      skinTexture = await loadTexture(`${texturesDir}skin.tex`);
    }
  } catch {
    skinTexture = new THREE.DataTexture(
      new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat,
    );
    skinTexture.needsUpdate = true;
  }

  let hairTexture: THREE.Texture;
  try {
    hairTexture = await loadTexture(`${texturesDir}hair.tex`);
  } catch {
    hairTexture = skinTexture;
  }

  // Parse 40-byte vertex format:
  // pos(3f,12B) normal(3f,12B) uv(2f,8B) boneIndices(4u8,4B) boneWeights(4u8,4B)
  const STRIDE = manifest.vertexStride; // 40
  const vCount = manifest.vertexCount;
  const rawBytes = new Uint8Array(binBuffer, 0, manifest.vertexBufferSize);
  const rawF32 = new Float32Array(binBuffer, 0, manifest.vertexBufferSize / 4);
  const STRIDE_F32 = STRIDE / 4; // 10

  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const uvs = new Float32Array(vCount * 2);
  const skinIndices = new Uint16Array(vCount * 4);
  const skinWeights = new Float32Array(vCount * 4);

  for (let i = 0; i < vCount; i++) {
    const f = i * STRIDE_F32;
    positions[i * 3 + 0] = rawF32[f + 0];
    positions[i * 3 + 1] = rawF32[f + 1];
    positions[i * 3 + 2] = rawF32[f + 2];

    normals[i * 3 + 0] = rawF32[f + 3];
    normals[i * 3 + 1] = rawF32[f + 4];
    normals[i * 3 + 2] = rawF32[f + 5];

    uvs[i * 2 + 0] = rawF32[f + 6];
    uvs[i * 2 + 1] = rawF32[f + 7];

    const byteBase = i * STRIDE;
    skinIndices[i * 4 + 0] = rawBytes[byteBase + 32];
    skinIndices[i * 4 + 1] = rawBytes[byteBase + 33];
    skinIndices[i * 4 + 2] = rawBytes[byteBase + 34];
    skinIndices[i * 4 + 3] = rawBytes[byteBase + 35];

    // Normalize uint8 [0,255] → float [0,1]
    skinWeights[i * 4 + 0] = rawBytes[byteBase + 36] / 255;
    skinWeights[i * 4 + 1] = rawBytes[byteBase + 37] / 255;
    skinWeights[i * 4 + 2] = rawBytes[byteBase + 38] / 255;
    skinWeights[i * 4 + 3] = rawBytes[byteBase + 39] / 255;
  }

  const fullIndexData = new Uint16Array(binBuffer, manifest.vertexBufferSize, manifest.indexCount);

  // Small polygon offset pushes body depth slightly back so helmet/equipment
  // dome geometry wins depth test in the thin overlap zone (~0.06 units)
  const hasHelmet = !!options?.armor?.helmet;
  const skinMaterial = new THREE.MeshLambertMaterial({
    map: skinTexture,
    side: THREE.DoubleSide,
    polygonOffset: hasHelmet,
    polygonOffsetFactor: hasHelmet ? 1 : 0,
    polygonOffsetUnits: hasHelmet ? 2000 : 0,
  });

  const hairMaterial = hairTexture === skinTexture
    ? skinMaterial
    : new THREE.MeshLambertMaterial({
        map: hairTexture,
        side: THREE.DoubleSide,
      });

  // Collect indices: skin vs hair, based on per-submesh textureType from M2 batch data.
  //
  // The M2 v256 texture lookup chain is broken in the converter — textureType
  // often resolves to wrong values (0/1/2/8 instead of 6 for hair geosets).
  // Strategy: for hair/facial-hair geosets, use a pre-pass to detect whether
  // a geoset ID has any unresolved (-1) entry. If so, type=1 entries for that
  // same ID are legitimate skin passes (multi-pass rendering). If not, all
  // entries are "lost" hair passes and should use hair texture.
  const skinIndexList: number[] = [];
  const hairIndexList: number[] = [];

  // Pre-pass: find which hair geoset IDs have an unresolved (-1) entry.
  // Those IDs have dual-pass rendering where type=1 entries are real skin passes.
  const hasUnresolvedPass = new Set<number>();
  for (const g of manifest.groups) {
    if (g.textureType < 0 && (HAIR_GEOSETS_FALLBACK.has(g.id) || isFacialHairGeoset(g.id))) {
      hasUnresolvedPass.add(g.id);
    }
  }

  for (const g of manifest.groups) {
    if (!geosets.has(g.id)) continue;
    if (g.textureType === 2) continue; // cape-textured geometry — skip when no cape equipped
    if (g.id === 0 && g.textureType === 0) continue; // hardcoded-texture body submesh (cape anchors)

    let isHair = false;
    const isHairGeoset = HAIR_GEOSETS_FALLBACK.has(g.id) || isFacialHairGeoset(g.id);

    if (g.textureType === HAIR_TEX_TYPE) {
      // Explicitly hair (type 6) — always trust
      isHair = true;
    } else if (g.textureType < 0 && isHairGeoset) {
      // Unresolved on a hair geoset — use hair texture
      isHair = true;
    } else if (g.textureType === 1 && HAIR_GEOSETS_FALLBACK.has(g.id) && !hasUnresolvedPass.has(g.id)) {
      // Type=1 on a hairstyle geoset (2-13) with NO unresolved pass → lost hair pass (e.g. tauren)
      // Only for hairstyle geosets, NOT facial hair (100-399) — those type=1 entries are real skin
      isHair = true;
    } else if (g.textureType !== 1 && g.textureType !== 8 && HAIR_GEOSETS_FALLBACK.has(g.id) && !hasUnresolvedPass.has(g.id)) {
      // Type=0/2/other on a hairstyle geoset with NO unresolved pass → lost hair pass (e.g. night elf type=0)
      isHair = true;
    }

    const target = isHair ? hairIndexList : skinIndexList;
    for (let i = 0; i < g.indexCount; i++) {
      target.push(fullIndexData[g.indexStart + i]);
    }
  }

  const pivot = new THREE.Group();
  pivot.rotation.x = -Math.PI / 2;

  // Build skeleton
  const { skeleton, roots } = buildSkeleton(manifest.bones);

  // Helper to create a SkinnedMesh from an index list
  function makeSkinnedMesh(indexList: number[], material: THREE.Material): THREE.SkinnedMesh {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geom.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
    geom.setIndex(new THREE.BufferAttribute(new Uint16Array(indexList), 1));
    const mesh = new THREE.SkinnedMesh(geom, material);
    mesh.bind(skeleton, new THREE.Matrix4());
    return mesh;
  }

  // Skin SkinnedMesh — body, hands, feet, legs. Owns the bone hierarchy.
  if (skinIndexList.length > 0) {
    const mesh = makeSkinnedMesh(skinIndexList, skinMaterial);
    for (const root of roots) {
      mesh.add(root);
    }
    pivot.add(mesh);
  }

  // Hair SkinnedMesh — shares the same skeleton (bones are in scene graph via skin mesh)
  if (hairIndexList.length > 0) {
    pivot.add(makeSkinnedMesh(hairIndexList, hairMaterial));
  }

  // Weapon attachment — attach item to HandRight bone (attachment ID 1)
  if (options?.weapon && manifest.attachments) {
    const att = manifest.attachments.find(a => a.id === 1); // HandRight
    if (att && att.bone < skeleton.bones.length) {
      const bone = skeleton.bones[att.bone];
      const socket = new THREE.Group();
      // att.pos is in bone-local M2 space — same coordinate frame as bone pivots
      socket.position.set(att.pos[0], att.pos[1], att.pos[2]);
      bone.add(socket);
      try {
        const weaponGroup = await loadItemModel(options.weapon, options.weaponTexture);
        socket.add(weaponGroup);
      } catch (err) {
        console.warn(`Failed to load weapon from ${options.weapon}:`, err);
      }
    } else if (!att) {
      console.warn('No HandRight attachment point (ID 1) found in manifest');
    }
  }

  // Offhand attachment — attach item to HandLeft bone (attachment ID 2)
  if (options?.offhand && manifest.attachments) {
    const att = manifest.attachments.find(a => a.id === 2); // HandLeft
    if (att && att.bone < skeleton.bones.length) {
      const bone = skeleton.bones[att.bone];
      const socket = new THREE.Group();
      socket.position.set(att.pos[0], att.pos[1], att.pos[2]);
      bone.add(socket);
      try {
        const offhandGroup = await loadItemModel(options.offhand, options.offhandTexture);
        socket.add(offhandGroup);
      } catch (err) {
        console.warn(`Failed to load offhand from ${options.offhand}:`, err);
      }
    } else if (!att) {
      console.warn('No HandLeft attachment point (ID 2) found in manifest');
    }
  }

  // Helmet attachment — attach to head bone (attachment ID 11)
  if (options?.armor?.helmet && manifest.attachments) {
    const modelSlug = modelDir.split('/').pop() || '';
    const att = manifest.attachments.find(a => a.id === 11); // Head
    if (att && att.bone < skeleton.bones.length) {
      const helmDir = `/items/head/${options.armor.helmet}/${modelSlug}`;
      const helmTexSlug = options.armor.helmetTexture || 'main';
      const helmTexUrl = `/items/head/${options.armor.helmet}/textures/${helmTexSlug}.tex`;
      const bone = skeleton.bones[att.bone];
      const socket = new THREE.Group();
      socket.position.set(att.pos[0], att.pos[1], att.pos[2]);
      bone.add(socket);
      try {
        const helmetGroup = await loadItemModel(helmDir, helmTexUrl);
        socket.add(helmetGroup);
      } catch (err) {
        console.warn(`Failed to load helmet from ${helmDir}:`, err);
      }
    }
  }

  // Shoulder attachment — L to attachment 6 (ShoulderLeft), R to attachment 5 (ShoulderRight)
  if (options?.armor?.shoulderSlug && manifest.attachments) {
    const slugBase = `/items/shoulder/${options.armor.shoulderSlug}`;
    const shoulderTexSlug = options.armor.shoulderTexture || 'main';
    const shoulderTexUrl = `${slugBase}/textures/${shoulderTexSlug}.tex`;

    // Left shoulder (attachment ID 6)
    const leftAtt = manifest.attachments.find(a => a.id === 6);
    if (leftAtt && leftAtt.bone < skeleton.bones.length) {
      const bone = skeleton.bones[leftAtt.bone];
      const socket = new THREE.Group();
      socket.position.set(leftAtt.pos[0], leftAtt.pos[1], leftAtt.pos[2]);
      bone.add(socket);
      try {
        const leftGroup = await loadItemModel(`${slugBase}/left`, shoulderTexUrl);
        socket.add(leftGroup);
      } catch (err) {
        console.warn(`Failed to load left shoulder:`, err);
      }
    }

    // Right shoulder (attachment ID 5)
    if (options.armor.shoulderHasRight) {
      const rightAtt = manifest.attachments.find(a => a.id === 5);
      if (rightAtt && rightAtt.bone < skeleton.bones.length) {
        const bone = skeleton.bones[rightAtt.bone];
        const socket = new THREE.Group();
        socket.position.set(rightAtt.pos[0], rightAtt.pos[1], rightAtt.pos[2]);
        bone.add(socket);
        try {
          const rightGroup = await loadItemModel(`${slugBase}/right`, shoulderTexUrl);
          socket.add(rightGroup);
        } catch (err) {
          console.warn(`Failed to load right shoulder:`, err);
        }
      }
    }
  }

  const group = new THREE.Group();
  group.add(pivot);
  return { group, bones: skeleton.bones, boneData: manifest.bones };
}

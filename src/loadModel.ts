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
export interface ChestEquipment {
  armUpperBase?: string;
  torsoUpperBase?: string;
  torsoLowerBase?: string;
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
  result.add(hairstyle);   // hairstyle from group 0

  for (const { group, preferred, strict } of DESIRED_GROUPS) {
    const available = byGroup.get(group);
    if (!available || available.length === 0) continue;
    const target = group * 100 + preferred;
    if (available.includes(target)) {
      result.add(target);
    } else if (!strict) {
      result.add(Math.min(...available));
    }
  }

  // Apply per-group overrides (e.g. chest enabling geoset 802 for short sleeves)
  if (groupOverrides) {
    for (const [grp, meshId] of groupOverrides) {
      const available = byGroup.get(grp);
      if (available?.includes(meshId)) {
        result.add(meshId);
      }
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
async function loadItemModel(itemDir: string): Promise<THREE.Group> {
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
    loadTexture(`${itemDir}/textures/main.tex`),
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
    chest?: ChestEquipment;
  },
): Promise<LoadedModel> {
  const texturesDir = `${modelDir}/textures/`;

  const [manifestRes, binRes] = await Promise.all([
    fetch(`${modelDir}/model.json`),
    fetch(`${modelDir}/model.bin`),
  ]);

  const manifest: ModelManifest = await manifestRes.json();
  const binBuffer = await binRes.arrayBuffer();

  const geosets = options?.enabledGeosets ?? resolveDefaultGeosets(manifest.groups, 5);

  // Derive gender suffix from modelDir slug (e.g. '/models/human-female' → 'F')
  const genderSuffix = modelDir.includes('-female') ? 'F' : 'M';

  // Load skin texture — with equipment compositing when chest is provided
  let skinTexture: THREE.Texture;
  try {
    if (options?.chest) {
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

      await tryAddLayer(options.chest.armUpperBase, CharRegion.ARM_UPPER);
      await tryAddLayer(options.chest.torsoUpperBase, CharRegion.TORSO_UPPER);
      await tryAddLayer(options.chest.torsoLowerBase, CharRegion.TORSO_LOWER);

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

  const skinMaterial = new THREE.MeshLambertMaterial({
    map: skinTexture,
    side: THREE.DoubleSide,
  });

  const hairMaterial = hairTexture === skinTexture
    ? skinMaterial
    : new THREE.MeshLambertMaterial({
        map: hairTexture,
        side: THREE.DoubleSide,
      });

  // Collect indices: skin vs hair, based on per-submesh textureType from M2 batch data.
  // textureType comes from the M2 batch → textureLookup → textureTable chain.
  // Fallback for legacy model.json without textureType: use geoset group heuristic.
  const skinIndexList: number[] = [];
  const hairIndexList: number[] = [];

  for (const g of manifest.groups) {
    if (!geosets.has(g.id)) continue;
    if (g.textureType === 2) continue; // cape-textured geometry — skip when no cape equipped
    if (g.id === 0 && g.textureType === 0) continue; // hardcoded-texture body submesh (cape anchors)
    const isHair = g.textureType !== undefined && g.textureType >= 0
      ? g.textureType === HAIR_TEX_TYPE
      : HAIR_GEOSETS_FALLBACK.has(g.id);
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
        const weaponGroup = await loadItemModel(options.weapon);
        socket.add(weaponGroup);
      } catch (err) {
        console.warn(`Failed to load weapon from ${options.weapon}:`, err);
      }
    } else if (!att) {
      console.warn('No HandRight attachment point (ID 1) found in manifest');
    }
  }

  const group = new THREE.Group();
  group.add(pivot);
  return { group, bones: skeleton.bones, boneData: manifest.bones };
}

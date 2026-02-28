import * as THREE from 'three';

interface BoneInfo {
  parent: number;
  pivot: [number, number, number];
  rotation: [number, number, number, number];
  translation: [number, number, number];
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
}

// Geoset visibility for a naked character.
// WoW default: each group gets value=1 → meshId = group*100 + 1.
// Group 13 (CG_TROUSERS) value=1 → 1301 = "legs" — the thigh geometry.
const DEFAULT_GEOSETS = new Set([
  0,     // body mesh
  5,     // hairstyle
  101,   // facial 1 default
  201,   // facial 2 default
  301,   // facial 3 default
  401,   // bare hands
  501,   // bare feet
  701,   // ears visible
  1301,  // trousers-as-legs (thigh geometry, Z 0.55–1.10)
]);

function isGeosetVisible(id: number, enabled: Set<number>): boolean {
  const group = Math.floor(id / 100);
  for (const eqId of enabled) {
    if (Math.floor(eqId / 100) === group && eqId === id) return true;
  }
  return false;
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
 * Load a character model from a directory.
 * @param modelDir - e.g. '/models/human-male' — loads model.json, model.bin, textures/skin.tex
 */
export async function loadModel(
  modelDir: string,
  enabledGeosets: Set<number> = DEFAULT_GEOSETS,
): Promise<THREE.Group> {
  const texturesDir = `${modelDir}/textures/`;

  const [manifestRes, binRes] = await Promise.all([
    fetch(`${modelDir}/model.json`),
    fetch(`${modelDir}/model.bin`),
  ]);

  const manifest: ModelManifest = await manifestRes.json();
  const binBuffer = await binRes.arrayBuffer();

  // Load textures
  let skinTexture: THREE.Texture;
  try {
    skinTexture = await loadTexture(`${texturesDir}skin.tex`);
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

  // Collect indices: skin vs hair, based on per-submesh textureType from M2 batch data
  const skinIndexList: number[] = [];
  const hairIndexList: number[] = [];

  for (const g of manifest.groups) {
    if (!isGeosetVisible(g.id, enabledGeosets)) continue;
    const target = g.textureType === HAIR_TEX_TYPE ? hairIndexList : skinIndexList;
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

  const group = new THREE.Group();
  group.add(pivot);
  return group;
}

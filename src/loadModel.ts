import * as THREE from 'three';

interface ModelManifest {
  vertexCount: number;
  indexCount: number;
  triangleCount: number;
  vertexBufferSize: number;
  indexBufferSize: number;
  vertexStride: number;
  groups: Array<{ id: number; indexStart: number; indexCount: number }>;
}

// Geoset visibility for a naked character.
//
// The body mesh (geoset 0) has a hole from Z 0.2 to Z 0.7 (the entire thigh
// region). This is filled by group 5 (boots/legs) and group 9 (upper legs).
// For a naked character: 501 = bare legs, 903 = upper leg bridge to body.
//
// Geoset group reference (group = floor(id/100)):
//   0xx: Body (0) + hairstyles (1-18)
//   1xx: Facial 1 (jaw/beard) — 101 = default
//   2xx: Facial 2 (sideburns) — 201 = default
//   3xx: Facial 3 (moustache) — 301 = default
//   4xx: Gloves — 401 = bare hands
//   5xx: Boots/legs — 501 = bare legs, 502+ = boots
//   7xx: Ears — 701 = ears visible
//   9xx: Upper legs — 903 bridges 501→body (Z 0.49–0.73)
//  10xx: Undershirt — none for naked
//  11xx: Pants — none for naked
//  12xx: Tabard — none
//  13xx: Robe — none
//  15xx: Cape — none
const DEFAULT_GEOSETS = new Set([
  0,     // body mesh (torso Z≥0.7, feet Z≤0.2 — hole Z 0.2–0.7 for legs)
  5,     // hairstyle 4 (long hair with braids — matches Hair04 texture)
  101,   // facial 1 default (jaw geometry)
  201,   // facial 2 default
  301,   // facial 3 default
  401,   // bare hands (Z 1.0–1.3)
  501,   // bare legs (Z 0.13–0.61, Y ±0.31) — fills body hole
  701,   // ears visible
  902,   // upper legs wider (Z 0.34–0.61, Y ±0.37)
  903,   // upper legs bridge (Z 0.49–0.73) — connects to body bottom
]);

function isGeosetVisible(id: number, enabled: Set<number>): boolean {
  const group = Math.floor(id / 100);
  for (const eqId of enabled) {
    if (Math.floor(eqId / 100) === group && eqId === id) return true;
  }
  return false;
}

/**
 * Load a .tex file (raw RGBA with 4-byte header: uint16 width + uint16 height)
 * and return a THREE.DataTexture.
 */
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

// Hair geosets (IDs 2-13) use hair texture (M2 texture type 6, texLookup=1).
const HAIR_GEOSETS = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

/**
 * Load a character model from a directory.
 * @param modelDir - e.g. '/models/human-male' — loads model.json, model.bin, textures/skin.tex
 */
export async function loadModel(
  modelDir: string,
  enabledGeosets: Set<number> = DEFAULT_GEOSETS,
): Promise<THREE.Group> {
  const texturesDir = `${modelDir}/textures/`;

  // Load manifest + binary in parallel
  const [manifestRes, binRes] = await Promise.all([
    fetch(`${modelDir}/model.json`),
    fetch(`${modelDir}/model.bin`),
  ]);

  const manifest: ModelManifest = await manifestRes.json();
  const binBuffer = await binRes.arrayBuffer();

  // Try to load skin texture, fall back to solid color
  let skinTexture: THREE.Texture;
  try {
    skinTexture = await loadTexture(`${texturesDir}skin.tex`);
  } catch {
    // Solid color fallback (medium gray-green for missing textures)
    skinTexture = new THREE.DataTexture(
      new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat,
    );
    skinTexture.needsUpdate = true;
  }

  // Try to load hair texture, fall back to skin texture
  let hairTexture: THREE.Texture;
  try {
    hairTexture = await loadTexture(`${texturesDir}hair.tex`);
  } catch {
    hairTexture = skinTexture;
  }

  // Vertex buffer: 8 floats per vertex (pos3 + normal3 + uv2)
  const vertexData = new Float32Array(binBuffer, 0, manifest.vertexBufferSize / 4);
  const fullIndexData = new Uint16Array(binBuffer, manifest.vertexBufferSize, manifest.indexCount);

  const interleavedBuffer = new THREE.InterleavedBuffer(vertexData, 8);

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

  // Collect indices: all skin geosets merged, hair separate.
  const skinIndices: number[] = [];
  const hairIndices: number[] = [];

  for (const g of manifest.groups) {
    if (!isGeosetVisible(g.id, enabledGeosets)) continue;
    const target = HAIR_GEOSETS.has(g.id) ? hairIndices : skinIndices;
    for (let i = 0; i < g.indexCount; i++) {
      target.push(fullIndexData[g.indexStart + i]);
    }
  }

  const pivot = new THREE.Group();
  pivot.rotation.x = -Math.PI / 2;

  // All skin geosets (body, hands, feet, facial, undershirt) — shared buffer
  if (skinIndices.length > 0) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 0));
    geom.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 3));
    geom.setAttribute('uv', new THREE.InterleavedBufferAttribute(interleavedBuffer, 2, 6));
    geom.setIndex(new THREE.BufferAttribute(new Uint16Array(skinIndices), 1));
    pivot.add(new THREE.Mesh(geom, skinMaterial));
  }

  // Neck patch — only for Human Male (fills the intentional hole at back of neck)
  if (modelDir.includes('human-male')) {
    const neckLoop = [
      [-0.133, -0.203, 1.668, 0.4688, 0.0293],
      [-0.174, -0.198, 1.582, 0.0039, 0.1133],
      [-0.142,  0.000, 1.613, 0.9961, 0.1250],
      [-0.174,  0.198, 1.582, 0.0039, 0.1133],
      [-0.133,  0.203, 1.668, 0.4688, 0.0293],
      [-0.047,  0.207, 1.710, 0.0352, 0.0039],
      [ 0.047,  0.090, 1.705, 0.5977, 0.0664],
      [-0.037,  0.091, 1.793, 0.6094, 0.0234],
      [-0.065,  0.000, 1.813, 0.9961, 0.0234],
      [-0.037, -0.091, 1.793, 0.6094, 0.0234],
      [ 0.047, -0.090, 1.705, 0.5977, 0.0664],
      [-0.047, -0.207, 1.710, 0.0352, 0.0039],
    ];
    const n = neckLoop.length;

    let cx = 0, cy = 0, cz = 0, cu = 0, cv = 0;
    for (const [x, y, z, u, v] of neckLoop) {
      cx += x; cy += y; cz += z; cu += u; cv += v;
    }
    cx /= n; cy /= n; cz /= n; cu /= n; cv /= n;

    const nx = -0.95, ny = 0, nz = 0.3;

    const patchVerts = new Float32Array((n + 1) * 8);
    patchVerts[0] = cx; patchVerts[1] = cy; patchVerts[2] = cz;
    patchVerts[3] = nx; patchVerts[4] = ny; patchVerts[5] = nz;
    patchVerts[6] = cu; patchVerts[7] = cv;
    for (let i = 0; i < n; i++) {
      const off = (i + 1) * 8;
      patchVerts[off + 0] = neckLoop[i][0];
      patchVerts[off + 1] = neckLoop[i][1];
      patchVerts[off + 2] = neckLoop[i][2];
      patchVerts[off + 3] = nx;
      patchVerts[off + 4] = ny;
      patchVerts[off + 5] = nz;
      patchVerts[off + 6] = neckLoop[i][3];
      patchVerts[off + 7] = neckLoop[i][4];
    }

    const patchIndices = new Uint16Array(n * 3);
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      patchIndices[i * 3 + 0] = 0;
      patchIndices[i * 3 + 1] = i + 1;
      patchIndices[i * 3 + 2] = next + 1;
    }

    const patchGeom = new THREE.BufferGeometry();
    const patchBuffer = new THREE.InterleavedBuffer(patchVerts, 8);
    patchGeom.setAttribute('position', new THREE.InterleavedBufferAttribute(patchBuffer, 3, 0));
    patchGeom.setAttribute('normal', new THREE.InterleavedBufferAttribute(patchBuffer, 3, 3));
    patchGeom.setAttribute('uv', new THREE.InterleavedBufferAttribute(patchBuffer, 2, 6));
    patchGeom.setIndex(new THREE.BufferAttribute(patchIndices, 1));
    pivot.add(new THREE.Mesh(patchGeom, skinMaterial));
  }

  // Hair mesh — uses hair texture
  if (hairIndices.length > 0) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 0));
    geom.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 3));
    geom.setAttribute('uv', new THREE.InterleavedBufferAttribute(interleavedBuffer, 2, 6));
    geom.setIndex(new THREE.BufferAttribute(new Uint16Array(hairIndices), 1));
    pivot.add(new THREE.Mesh(geom, hairMaterial));
  }

  const group = new THREE.Group();
  group.add(pivot);
  return group;
}

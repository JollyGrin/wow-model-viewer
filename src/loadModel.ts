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

// Geoset visibility for a "naked with underwear" character.
//
// The body mesh (geoset 0) has intentional holes filled by default geosets:
//   - Mouth hole → filled by facial features (101, 201, 301)
//   - Upper leg hole → filled by underwear/pants (1102)
//   - Upper back hole → filled by undershirt (1002)
//
// Group 0 (IDs 0-99) are hairstyle variants. Only ONE should be active.
// ID 0 = bald base, 1-13 = hairstyle options.
//
// Geoset group reference (group = floor(id/100)):
//   0xx: Hairstyles (pick one)
//   1xx: Facial 1 (jaw/beard) — 101 = default
//   2xx: Facial 2 (sideburns) — 201 = default
//   3xx: Facial 3 (moustache) — 301 = default
//   4xx: Gloves — 401 = bare hands
//   5xx: Boots — 501 = bare feet
//   7xx: Ears — 701 = ears visible
//   8xx: Sleeves — none = bare arms
//   9xx: Kneepads — none = bare legs
//  10xx: Undershirt — 1002 = base (fills upper back hole)
//  11xx: Pants — 1102 = underwear (fills upper leg hole)
//  12xx: Tabard — none
//  13xx: Robe — none
//  15xx: Cape — none
const DEFAULT_GEOSETS = new Set([
  0,     // body mesh (torso, waist, head, feet)
  1,     // bald scalp cap (body mesh leaves top of head open)
  101,   // facial 1 default (jaw geometry)
  201,   // facial 2 default
  301,   // facial 3 default
  401,   // bare hands
  501,   // bare feet / lower legs
  701,   // ears visible
  903,   // kneepads — bridges gap between boots (Z 0.61) and body (Z 0.70)
  1002,  // undershirt base (fills upper back/chest gap)
  1102,  // underwear/pants (fills hip band)
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
  // WoW textures wrap by default
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Flip V to match WoW UV convention (WoW V=0 is top, Three.js V=0 is bottom)
  texture.flipY = false;
  return texture;
}

export async function loadModel(
  basePath: string,
  enabledGeosets: Set<number> = DEFAULT_GEOSETS,
): Promise<THREE.Group> {
  // Load manifest, binary, and texture in parallel
  const [manifestRes, binRes, skinTexture] = await Promise.all([
    fetch(`${basePath}.json`),
    fetch(`${basePath}.bin`),
    loadTexture(`${basePath.replace(/[^/]+$/, '')}textures/human-male-skin.tex`),
  ]);

  const manifest: ModelManifest = await manifestRes.json();
  const binBuffer = await binRes.arrayBuffer();

  // Vertex buffer: 8 floats per vertex (pos3 + normal3 + uv2)
  const vertexData = new Float32Array(binBuffer, 0, manifest.vertexBufferSize / 4);
  const fullIndexData = new Uint16Array(binBuffer, manifest.vertexBufferSize, manifest.indexCount);

  // Build filtered index buffer — only geosets in the enabled set
  const filteredIndices: number[] = [];
  for (const g of manifest.groups) {
    if (isGeosetVisible(g.id, enabledGeosets)) {
      for (let i = 0; i < g.indexCount; i++) {
        filteredIndices.push(fullIndexData[g.indexStart + i]);
      }
    }
  }

  const indexData = new Uint16Array(filteredIndices);

  const geometry = new THREE.BufferGeometry();
  const interleavedBuffer = new THREE.InterleavedBuffer(vertexData, 8);
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 0));
  geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 3));
  geometry.setAttribute('uv', new THREE.InterleavedBufferAttribute(interleavedBuffer, 2, 6));
  geometry.setIndex(new THREE.BufferAttribute(indexData, 1));

  const material = new THREE.MeshStandardMaterial({
    map: skinTexture,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0.0,
  });

  const mesh = new THREE.Mesh(geometry, material);

  // WoW Z-up → Three.js Y-up
  mesh.rotation.x = -Math.PI / 2;

  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

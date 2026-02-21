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
// WoW's GeosRenderPrep sets geosetGroupValue=1 for all groups by default.
// Formula: enabled_meshId = groupBase + geosetGroupValue + 1.
// Equipment overrides specific groups; empty slots reset some to 0.
//
// Group 0 (IDs 0-99) are hairstyle variants. Only ONE should be active.
//
// Geoset group reference (group = floor(id/100)):
//   0xx: Hairstyles (pick one)
//   1xx: Facial 1 (jaw/beard) — 101 = default
//   2xx: Facial 2 (sideburns) — 201 = default
//   3xx: Facial 3 (moustache) — 301 = default
//   4xx: Gloves — 401 = bare hands (empty slot resets to value 0)
//   5xx: Boots — 502 = default leg coverage (value 1); 501 = bare feet (value 0)
//   7xx: Ears — 701 = ears visible
//   8xx: Sleeves — 802 = default (value 1); 801 DNE = bare arms
//   9xx: Kneepads — 902 = default (value 1, Z 0.34–0.61); 903 = variant (Z 0.49–0.73)
//  10xx: Undershirt — 1002 = default (value 1), fills upper back hole
//  11xx: Pants — 1102 = default (value 1), ALL outward flare geometry;
//         omitted: without underwear texture compositing it creates a skin-colored
//         skirt. Thigh gap is acceptable until texture compositing is implemented.
//  12xx: Tabard — none
//  13xx: Robe — none
//  15xx: Cape — none
const DEFAULT_GEOSETS = new Set([
  0,     // body mesh (torso, waist, head, feet)
  5,     // hairstyle 4 (long hair with braids — matches Hair04 texture)
  101,   // facial 1 default (jaw geometry)
  201,   // facial 2 default
  301,   // facial 3 default
  401,   // bare hands
  502,   // default boots (geosetGroupValue=1: 500+1+1=502, 142 tris vs 501's 86)
  701,   // ears visible
  902,   // default kneepads (geosetGroupValue=1: 900+1+1=902, Z 0.34–0.61)
  903,   // extra kneepads — bridges gap between 902 top (Z 0.61) and body (Z 0.70)
  1002,  // undershirt — fills upper back/chest hole
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
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = false;
  return texture;
}

// Hair geosets (IDs 2-13) use hair texture (M2 texture type 6, texLookup=1).
const HAIR_GEOSETS = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

export async function loadModel(
  basePath: string,
  enabledGeosets: Set<number> = DEFAULT_GEOSETS,
): Promise<THREE.Group> {
  const texturesDir = `${basePath.replace(/[^/]+$/, '')}textures/`;
  const [manifestRes, binRes, skinTexture, hairTexture] = await Promise.all([
    fetch(`${basePath}.json`),
    fetch(`${basePath}.bin`),
    loadTexture(`${texturesDir}human-male-skin.tex`),
    loadTexture(`${texturesDir}human-male-hair.tex`),
  ]);

  const manifest: ModelManifest = await manifestRes.json();
  const binBuffer = await binRes.arrayBuffer();

  // Vertex buffer: 8 floats per vertex (pos3 + normal3 + uv2)
  const vertexData = new Float32Array(binBuffer, 0, manifest.vertexBufferSize / 4);
  const fullIndexData = new Uint16Array(binBuffer, manifest.vertexBufferSize, manifest.indexCount);

  const interleavedBuffer = new THREE.InterleavedBuffer(vertexData, 8);

  const skinMaterial = new THREE.MeshLambertMaterial({
    map: skinTexture,
    side: THREE.DoubleSide,
  });

  const hairMaterial = new THREE.MeshLambertMaterial({
    map: hairTexture,
    side: THREE.DoubleSide,
  });

  // Collect indices: all skin-textured geosets merged, hair separate
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

  // Merged body + clothing mesh — single draw call
  if (skinIndices.length > 0) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 0));
    geom.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 3));
    geom.setAttribute('uv', new THREE.InterleavedBufferAttribute(interleavedBuffer, 2, 6));
    geom.setIndex(new THREE.BufferAttribute(new Uint16Array(skinIndices), 1));
    pivot.add(new THREE.Mesh(geom, skinMaterial));
  }

  // Neck patch — fills the intentional hole at the back of the neck
  {
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

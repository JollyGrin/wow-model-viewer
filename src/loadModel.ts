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
// For empty equipment slots, the geoset is determined by the slot's default.
// Bare skin character: body + facial features + bare hands + bare feet.
// Equipment geosets (kneepads 9xx, undershirt 10xx, pants 11xx) are only shown
// when equipment is worn. The thigh gap between body waist (Z 0.72) and bare
// feet top (Z 0.61) is filled by generated thigh bridge geometry below.
//
// Geoset group reference (group = floor(id/100)):
//   0xx: Hairstyles (pick one)
//   1xx: Facial 1 (jaw/beard) — 101 = default
//   2xx: Facial 2 (sideburns) — 201 = default
//   3xx: Facial 3 (moustache) — 301 = default
//   4xx: Gloves — 401 = bare hands
//   5xx: Boots — 501 = bare feet/lower legs (86 tris, Z 0.13–0.61)
//   7xx: Ears — 701 = ears visible
//   9xx: Kneepads — none for naked (902/903 are armor pieces)
//  10xx: Undershirt — none for naked (1002 flares outward, creates skirt)
//  11xx: Pants — none for naked (1102 is all outward flare geometry)
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
  501,   // bare feet + lower legs (Z 0.13–0.61)
  701,   // ears visible
  1002,  // undershirt — fills upper back/chest (Z 0.93–1.11), above waist
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

  // Thigh bridge — fills the gap between bare feet top (Z ~0.58) and body waist (Z ~0.72).
  // The body mesh has no thigh geometry; WoW fills this with texture compositing.
  // We generate tube geometry for each leg with smooth curvature using 5 rings.
  {
    const N = 6;          // vertices per ring
    const RINGS = 5;      // smooth curvature

    // 501 top boundary: 6 unique positions per leg, sorted by angle around leg axis.
    const leftBottom: [number, number, number][] = [
      [-0.1085, -0.2338, 0.6135],  // 0: back-outer (-144°)
      [-0.0372, -0.2663, 0.6030],  // 1: outer (-98°)
      [ 0.0564, -0.2281, 0.5630],  // 2: front-outer (-35°)
      [ 0.0515, -0.1447, 0.5487],  // 3: front-inner (20°)
      [-0.0112, -0.0979, 0.5707],  // 4: inner/crotch (80°)
      [-0.1067, -0.1381, 0.5990],  // 5: back-inner (158°)
    ];

    // Top ring — all vertices extend up into the body mesh overlap zone.
    // Outer vertices at Z=0.80 (body mesh at Z=0.80 has |Y|~0.54, so |Y|=0.48
    // sits inside). Inner vertices at Z=0.84 (fills pelvis shadow zone).
    const leftTop: [number, number, number][] = [
      [-0.10, -0.46, 0.80],   // 0: back-outer (hidden inside body hip)
      [-0.03, -0.48, 0.80],   // 1: outer (hidden inside body hip)
      [ 0.05, -0.42, 0.80],   // 2: front-outer (hidden inside body hip)
      [ 0.04, -0.05, 0.84],   // 3: front-inner (fills pelvis)
      [-0.01, -0.02, 0.84],   // 4: inner/crotch (fills pelvis)
      [-0.09, -0.05, 0.84],   // 5: back-inner (fills pelvis)
    ];

    // UVs: bottom (from 501) and top (approaching body waist)
    const bottomUVs: [number, number][] = [
      [0.8008, 0.6875], [0.7500, 0.6875], [0.6836, 0.6875],
      [0.5625, 0.6875], [0.5039, 0.6875], [0.9375, 0.6875],
    ];
    const topUVs: [number, number][] = bottomUVs.map(([u]) => [u, 0.62]);

    // Build vertices for both legs: 5 rings × 6 verts × 2 legs = 60 verts
    const totalVerts = N * RINGS * 2;
    const positions = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);

    function writeLeg(rings: [number, number, number][][], baseVert: number) {
      for (let r = 0; r < RINGS; r++) {
        for (let v = 0; v < N; v++) {
          const vi = baseVert + r * N + v;
          const pos = rings[r][v];
          positions[vi * 3] = pos[0];
          positions[vi * 3 + 1] = pos[1];
          positions[vi * 3 + 2] = pos[2];
          // UV: interpolate v coordinate from 0.6875 to 0.62
          const t = r / (RINGS - 1);
          uvs[vi * 2] = bottomUVs[v][0] + (topUVs[v][0] - bottomUVs[v][0]) * t;
          uvs[vi * 2 + 1] = bottomUVs[v][1] + (topUVs[v][1] - bottomUVs[v][1]) * t;
        }
      }
    }

    // Generate intermediate rings with ease-out interpolation (sqrt)
    // This makes the thigh expand rapidly at the bottom and flatten at the top
    function makeRings(bottom: [number, number, number][], top: [number, number, number][]) {
      const rings: [number, number, number][][] = [];
      for (let r = 0; r < RINGS; r++) {
        const tLinear = r / (RINGS - 1);
        const t = Math.sqrt(tLinear); // ease-out: expand quickly near bottom
        rings.push(bottom.map((b, i) => [
          b[0] + (top[i][0] - b[0]) * t,
          b[1] + (top[i][1] - b[1]) * t,
          b[2] + (top[i][2] - b[2]) * t,
        ]));
      }
      return rings;
    }

    const leftRings = makeRings(leftBottom, leftTop);
    const rightRings = makeRings(
      leftBottom.map(([x, y, z]) => [x, -y, z] as [number, number, number]),
      leftTop.map(([x, y, z]) => [x, -y, z] as [number, number, number]),
    );

    writeLeg(leftRings, 0);
    writeLeg(rightRings, N * RINGS);

    // Build index buffer: connect adjacent rings + crotch bridge
    const thighIdx: number[] = [];

    function connectRings(baseA: number, baseB: number) {
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        thighIdx.push(baseA + i, baseB + i, baseA + j);
        thighIdx.push(baseA + j, baseB + i, baseB + j);
      }
    }

    // Left leg
    for (let r = 0; r < RINGS - 1; r++) {
      connectRings(r * N, (r + 1) * N);
    }
    // Right leg
    const RB = N * RINGS; // right leg base
    for (let r = 0; r < RINGS - 1; r++) {
      connectRings(RB + r * N, RB + (r + 1) * N);
    }

    // Crotch bridge: connect left and right inner thigh top ring vertices
    const LT = (RINGS - 1) * N;     // left top ring start
    const RT = RB + (RINGS - 1) * N; // right top ring start
    thighIdx.push(LT + 3, LT + 4, RT + 4);
    thighIdx.push(LT + 3, RT + 4, RT + 3);
    thighIdx.push(LT + 4, LT + 5, RT + 5);
    thighIdx.push(LT + 4, RT + 5, RT + 4);

    const thighGeom = new THREE.BufferGeometry();
    thighGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    thighGeom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    thighGeom.setIndex(new THREE.BufferAttribute(new Uint16Array(thighIdx), 1));
    thighGeom.computeVertexNormals();
    pivot.add(new THREE.Mesh(thighGeom, skinMaterial));
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

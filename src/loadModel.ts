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
  903,   // kneepads — bridges gap between boots and body
  1002,  // undershirt base (fills upper back/chest gap)
  1102,  // underwear/pants (fills hip band — renders FrontSide to reduce skirt)
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

// Geosets that represent the base body layer — these get polygonOffset
// to push them slightly forward so they occlude inner clothing geometry.
const BODY_LAYER_GEOSETS = new Set([0, 1, 101, 201, 301, 401, 501, 701]);

// Clothing geosets that sit directly against the body surface.
// These get shrunk inward toward the body centroid at their height
// and rendered with FrontSide + depthWrite so the body occludes them.
const CLOTHING_GEOSETS = new Set([903, 1002, 1102]);

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

  const interleavedBuffer = new THREE.InterleavedBuffer(vertexData, 8);

  // Build a spatial index of body vertices for snapping clothing verts inward.
  // For each clothing vertex, find the nearest body vertex and lerp toward it.
  const bodyVertexIndices = new Set<number>();
  for (const g of manifest.groups) {
    if (!isGeosetVisible(g.id, enabledGeosets)) continue;
    if (!BODY_LAYER_GEOSETS.has(g.id)) continue;
    for (let i = 0; i < g.indexCount; i++) {
      bodyVertexIndices.add(fullIndexData[g.indexStart + i]);
    }
  }

  // Shrink clothing geosets radially toward body centroid at each height.
  // Clamps to a minimum radius to prevent inner-thigh collapse.
  const clothingVertexData = new Float32Array(vertexData);
  const clothingVertexSet = new Set<number>();
  for (const g of manifest.groups) {
    if (!isGeosetVisible(g.id, enabledGeosets)) continue;
    if (!CLOTHING_GEOSETS.has(g.id)) continue;
    for (let i = 0; i < g.indexCount; i++) {
      clothingVertexSet.add(fullIndexData[g.indexStart + i]);
    }
  }

  // Build height-binned body stats (centroid + min/max radius)
  const BIN_SIZE = 0.05;
  const bodyBins = new Map<number, { sumX: number; sumY: number; count: number; minR: number; maxR: number }>();
  // First pass: compute centroids
  for (const bi of bodyVertexIndices) {
    const bb = bi * 8;
    const z = vertexData[bb + 2];
    const bin = Math.round(z / BIN_SIZE);
    let entry = bodyBins.get(bin);
    if (!entry) { entry = { sumX: 0, sumY: 0, count: 0, minR: Infinity, maxR: 0 }; bodyBins.set(bin, entry); }
    entry.sumX += vertexData[bb + 0];
    entry.sumY += vertexData[bb + 1];
    entry.count++;
  }
  // Second pass: compute radii from centroids
  for (const bi of bodyVertexIndices) {
    const bb = bi * 8;
    const z = vertexData[bb + 2];
    const bin = Math.round(z / BIN_SIZE);
    const entry = bodyBins.get(bin)!;
    const centX = entry.sumX / entry.count;
    const centY = entry.sumY / entry.count;
    const r = Math.sqrt((vertexData[bb + 0] - centX) ** 2 + (vertexData[bb + 1] - centY) ** 2);
    if (r < entry.minR) entry.minR = r;
    if (r > entry.maxR) entry.maxR = r;
  }

  const SHRINK = 0.55; // moderate shrink toward centroid
  for (const vi of clothingVertexSet) {
    const base = vi * 8;
    const cx = clothingVertexData[base + 0];
    const cy = clothingVertexData[base + 1];
    const cz = clothingVertexData[base + 2];
    const bin = Math.round(cz / BIN_SIZE);

    let entry = bodyBins.get(bin);
    if (!entry) {
      for (let d = 1; d < 10; d++) {
        entry = bodyBins.get(bin + d) || bodyBins.get(bin - d);
        if (entry) break;
      }
    }
    if (!entry) continue;

    const centX = entry.sumX / entry.count;
    const centY = entry.sumY / entry.count;
    const dx = cx - centX;
    const dy = cy - centY;
    const currentR = Math.sqrt(dx * dx + dy * dy);

    if (currentR < 0.001) continue; // at center already

    // Shrink toward centroid
    let newX = cx + (centX - cx) * SHRINK;
    let newY = cy + (centY - cy) * SHRINK;

    // Clamp: don't let radius go below the body's minimum radius at this height
    // This prevents inner-thigh vertices from collapsing through each other
    const newDx = newX - centX;
    const newDy = newY - centY;
    const newR = Math.sqrt(newDx * newDx + newDy * newDy);
    const minR = entry.minR * 0.85; // slightly inside body min
    if (newR < minR && currentR > minR) {
      const scale = minR / newR;
      newX = centX + newDx * scale;
      newY = centY + newDy * scale;
    }

    clothingVertexData[base + 0] = newX;
    clothingVertexData[base + 1] = newY;
  }
  const clothingInterleavedBuffer = new THREE.InterleavedBuffer(clothingVertexData, 8);

  const bodyMaterial = new THREE.MeshLambertMaterial({
    map: skinTexture,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  // Clothing: FrontSide culls inward-facing triangles that cause the "skirt" look
  const clothingMaterial = new THREE.MeshLambertMaterial({
    map: skinTexture,
    side: THREE.FrontSide,
  });

  // Collect indices per layer (body vs clothing)
  const bodyIndices: number[] = [];
  const clothingIndices: number[] = [];

  for (const g of manifest.groups) {
    if (!isGeosetVisible(g.id, enabledGeosets)) continue;
    const target = CLOTHING_GEOSETS.has(g.id) ? clothingIndices : bodyIndices;
    for (let i = 0; i < g.indexCount; i++) {
      target.push(fullIndexData[g.indexStart + i]);
    }
  }

  const pivot = new THREE.Group();
  // WoW Z-up → Three.js Y-up
  pivot.rotation.x = -Math.PI / 2;

  // Clothing mesh rendered FIRST (behind body in painter's order isn't needed,
  // Z-buffer handles it, but body's polygonOffset pushes it forward)
  if (clothingIndices.length > 0) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.InterleavedBufferAttribute(clothingInterleavedBuffer, 3, 0));
    geom.setAttribute('normal', new THREE.InterleavedBufferAttribute(clothingInterleavedBuffer, 3, 3));
    geom.setAttribute('uv', new THREE.InterleavedBufferAttribute(clothingInterleavedBuffer, 2, 6));
    geom.setIndex(new THREE.BufferAttribute(new Uint16Array(clothingIndices), 1));
    pivot.add(new THREE.Mesh(geom, clothingMaterial));
  }

  // Body mesh — polygonOffset pushes it forward in depth so it occludes clothing
  if (bodyIndices.length > 0) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 0));
    geom.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 3));
    geom.setAttribute('uv', new THREE.InterleavedBufferAttribute(interleavedBuffer, 2, 6));
    geom.setIndex(new THREE.BufferAttribute(new Uint16Array(bodyIndices), 1));
    pivot.add(new THREE.Mesh(geom, bodyMaterial));
  }

  const group = new THREE.Group();
  group.add(pivot);
  return group;
}

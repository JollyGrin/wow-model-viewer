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

// Default geosets for a naked character (from docs/research/03-character-rendering-pipeline.md)
//
// IDs 0-99: Always-visible body mesh sections (different body parts like torso,
//           head, upper legs, etc.) — ALL are shown regardless of equipment.
//
// IDs 100+: Equipment/customization geosets. Group = floor(id/100).
//   1xx: Facial hair 1 — from customization
//   2xx: Facial hair 2 — from customization
//   3xx: Facial hair 3 — from customization
//   4xx: 401 = bare hands
//   5xx: 501 = bare feet
//   7xx: 701 = ears visible
//   8xx: 801 = bare arms
//   9xx: 901 = bare legs
//  10xx+: disabled (no tabard, robe, cape, etc.)
const DEFAULT_EQUIPMENT_GEOSETS = new Set([401, 501, 701]);

function isGeosetVisible(id: number, equipment: Set<number>): boolean {
  // Body mesh sections (id < 100) are always visible
  if (id < 100) return true;

  // For equipment groups (id >= 100), check if this specific variant is enabled
  const group = Math.floor(id / 100);
  for (const eqId of equipment) {
    if (Math.floor(eqId / 100) === group && eqId === id) return true;
  }
  return false;
}

export async function loadModel(
  basePath: string,
  enabledGeosets: Set<number> = DEFAULT_EQUIPMENT_GEOSETS,
): Promise<THREE.Group> {
  const [manifestRes, binRes] = await Promise.all([
    fetch(`${basePath}.json`),
    fetch(`${basePath}.bin`),
  ]);

  const manifest: ModelManifest = await manifestRes.json();
  const binBuffer = await binRes.arrayBuffer();

  const vertexData = new Float32Array(binBuffer, 0, manifest.vertexBufferSize / 4);
  const fullIndexData = new Uint16Array(binBuffer, manifest.vertexBufferSize, manifest.indexCount);

  // Build filtered index buffer — body parts (< 100) always included,
  // equipment geosets (>= 100) only if in enabledGeosets
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
  const interleavedBuffer = new THREE.InterleavedBuffer(vertexData, 6);
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 0));
  geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 3));
  geometry.setIndex(new THREE.BufferAttribute(indexData, 1));

  const material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);

  // WoW Z-up → Three.js Y-up
  mesh.rotation.x = -Math.PI / 2;

  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

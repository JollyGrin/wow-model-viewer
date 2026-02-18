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

export async function loadModel(basePath: string): Promise<THREE.Group> {
  const [manifestRes, binRes] = await Promise.all([
    fetch(`${basePath}.json`),
    fetch(`${basePath}.bin`),
  ]);

  const manifest: ModelManifest = await manifestRes.json();
  const binBuffer = await binRes.arrayBuffer();

  // Split binary into vertex and index buffers
  const vertexData = new Float32Array(binBuffer, 0, manifest.vertexBufferSize / 4);
  const indexData = new Uint16Array(binBuffer, manifest.vertexBufferSize, manifest.indexCount);

  // Build BufferGeometry
  // Vertex layout: 6 floats per vertex (position xyz, normal xyz) = 24 bytes stride
  const geometry = new THREE.BufferGeometry();

  const interleavedBuffer = new THREE.InterleavedBuffer(vertexData, 6); // 6 floats stride
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 0)); // 3 floats at offset 0
  geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 3));   // 3 floats at offset 3

  geometry.setIndex(new THREE.BufferAttribute(indexData, 1));

  const material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);

  // WoW Z-up → Three.js Y-up
  mesh.rotation.x = -Math.PI / 2;

  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadModel } from './loadModel';

// Mock fetch for Node.js test environment
const mockManifest = {
  vertexCount: 4,
  indexCount: 6,
  triangleCount: 2,
  vertexBufferSize: 96, // 4 vertices * 24 bytes
  indexBufferSize: 12,  // 6 indices * 2 bytes
  vertexStride: 24,
  groups: [{ id: 0, indexStart: 0, indexCount: 6 }],
};

function buildMockBinary() {
  const buf = new ArrayBuffer(96 + 12);
  const floats = new Float32Array(buf, 0, 24); // 4 vertices * 6 floats
  // Simple quad: 4 vertices with positions and normals
  // v0: (0,0,0) n(0,0,1)
  floats.set([0, 0, 0, 0, 0, 1], 0);
  // v1: (1,0,0) n(0,0,1)
  floats.set([1, 0, 0, 0, 0, 1], 6);
  // v2: (1,1,0) n(0,0,1)
  floats.set([1, 1, 0, 0, 0, 1], 12);
  // v3: (0,1,0) n(0,0,1)
  floats.set([0, 1, 0, 0, 0, 1], 18);

  const indices = new Uint16Array(buf, 96, 6);
  indices.set([0, 1, 2, 0, 2, 3]);

  return buf;
}

beforeEach(() => {
  const mockBin = buildMockBinary();

  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.endsWith('.json')) {
      return Promise.resolve({
        json: () => Promise.resolve(mockManifest),
      });
    }
    if (url.endsWith('.bin')) {
      return Promise.resolve({
        arrayBuffer: () => Promise.resolve(mockBin),
      });
    }
    return Promise.reject(new Error(`Unknown URL: ${url}`));
  }));
});

describe('loadModel', () => {
  it('returns a Group containing a Mesh', async () => {
    const group = await loadModel('/models/test');
    expect(group.type).toBe('Group');
    expect(group.children.length).toBe(1);
    expect(group.children[0].type).toBe('Mesh');
  });

  it('mesh has position and normal attributes', async () => {
    const group = await loadModel('/models/test');
    const mesh = group.children[0] as any;
    const geometry = mesh.geometry;
    expect(geometry.getAttribute('position')).toBeDefined();
    expect(geometry.getAttribute('normal')).toBeDefined();
  });

  it('applies Z-up to Y-up rotation', async () => {
    const group = await loadModel('/models/test');
    const mesh = group.children[0] as any;
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('uses DoubleSide material', async () => {
    const group = await loadModel('/models/test');
    const mesh = group.children[0] as any;
    // THREE.DoubleSide = 2
    expect(mesh.material.side).toBe(2);
  });

  it('geometry has correct vertex count', async () => {
    const group = await loadModel('/models/test');
    const mesh = group.children[0] as any;
    const posAttr = mesh.geometry.getAttribute('position');
    expect(posAttr.count).toBe(4);
  });

  it('geometry has index buffer', async () => {
    const group = await loadModel('/models/test');
    const mesh = group.children[0] as any;
    expect(mesh.geometry.index).not.toBeNull();
    expect(mesh.geometry.index.count).toBe(6);
  });
});

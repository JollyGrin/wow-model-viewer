import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadModel } from './loadModel';

// 4 vertices × 8 floats = 32 floats = 128 bytes vertex buffer
// 27 indices × 2 bytes = 54 bytes index buffer
const mockManifest = {
  vertexCount: 4,
  indexCount: 27,
  triangleCount: 9,
  vertexBufferSize: 128,
  indexBufferSize: 54,
  vertexStride: 32,
  groups: [
    { id: 0, indexStart: 0, indexCount: 3 },     // body mesh
    { id: 1, indexStart: 3, indexCount: 3 },     // bald scalp cap
    { id: 5, indexStart: 6, indexCount: 3 },     // hairstyle variant (in HAIR_GEOSETS)
    { id: 101, indexStart: 9, indexCount: 3 },   // facial default
    { id: 401, indexStart: 12, indexCount: 3 },  // bare hands
    { id: 402, indexStart: 15, indexCount: 3 },  // short gloves
    { id: 903, indexStart: 18, indexCount: 3 },  // kneepads (bridges knee gap)
    { id: 1301, indexStart: 21, indexCount: 3 }, // robe
    { id: 1102, indexStart: 24, indexCount: 3 }, // underwear
  ],
};

function buildMockBinary() {
  const buf = new ArrayBuffer(128 + 54);
  const floats = new Float32Array(buf, 0, 32);
  // 4 vertices: pos(3) + normal(3) + uv(2) = 8 floats each
  floats.set([0, 0, 0, 0, 0, 1, 0, 0], 0);
  floats.set([1, 0, 0, 0, 0, 1, 1, 0], 8);
  floats.set([1, 1, 0, 0, 0, 1, 1, 1], 16);
  floats.set([0, 1, 0, 0, 0, 1, 0, 1], 24);
  const indices = new Uint16Array(buf, 128, 27);
  indices.set([0, 1, 2, 0, 2, 3, 1, 2, 3, 0, 1, 3, 0, 3, 2, 1, 3, 0, 0, 2, 3, 1, 0, 3, 0, 1, 3]);
  return buf;
}

beforeEach(() => {
  const mockBin = buildMockBinary();
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.endsWith('.json')) return Promise.resolve({ json: () => Promise.resolve(mockManifest) });
    if (url.endsWith('.bin')) return Promise.resolve({ arrayBuffer: () => Promise.resolve(mockBin) });
    // Texture fetches fail gracefully (triggers fallback)
    return Promise.reject(new Error(`Unknown URL: ${url}`));
  }));
});

describe('loadModel', () => {
  it('returns a Group containing a pivot Group with meshes', async () => {
    const group = await loadModel('/models/test');
    expect(group.type).toBe('Group');
    expect(group.children.length).toBe(1);
    const pivot = group.children[0];
    expect(pivot.type).toBe('Group');
    expect(pivot.children.length).toBeGreaterThan(0);
    expect(pivot.children[0].type).toBe('Mesh');
  });

  it('applies Z-up to Y-up rotation on pivot', async () => {
    const group = await loadModel('/models/test');
    const pivot = group.children[0];
    expect(pivot.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('defaults include body, hairstyle5, facial, hands, kneepads — excludes bald, gloves, robe, underwear', async () => {
    const group = await loadModel('/models/test');
    const pivot = group.children[0];
    // Skin mesh: id=0(3) + id=101(3) + id=401(3) + id=903(3) = 12
    // Hair mesh: id=5(3) = 3
    const skinMesh = pivot.children[0] as any;
    const hairMesh = pivot.children[1] as any;
    expect(skinMesh.geometry.index.count).toBe(12);
    expect(hairMesh.geometry.index.count).toBe(3);
  });

  it('can equip gloves by swapping geoset variant', async () => {
    const geosets = new Set([0, 5, 101, 201, 301, 402, 502, 701, 903, 1002]);
    const group = await loadModel('/models/test', geosets);
    const pivot = group.children[0];
    // Skin mesh: id=0(3) + id=101(3) + id=402(3) + id=903(3) = 12
    const skinMesh = pivot.children[0] as any;
    expect(skinMesh.geometry.index.count).toBe(12);
  });

  it('can enable robe geoset', async () => {
    const geosets = new Set([0, 5, 101, 201, 301, 401, 502, 701, 903, 1002, 1301]);
    const group = await loadModel('/models/test', geosets);
    const pivot = group.children[0];
    // Skin mesh: id=0(3) + id=101(3) + id=401(3) + id=903(3) + id=1301(3) = 15
    const skinMesh = pivot.children[0] as any;
    expect(skinMesh.geometry.index.count).toBe(15);
  });
});

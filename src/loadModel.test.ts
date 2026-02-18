import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadModel } from './loadModel';

const mockManifest = {
  vertexCount: 4,
  indexCount: 27,
  triangleCount: 9,
  vertexBufferSize: 96,
  indexBufferSize: 54,
  vertexStride: 24,
  groups: [
    { id: 0, indexStart: 0, indexCount: 3 },     // body mesh
    { id: 1, indexStart: 3, indexCount: 3 },     // bald scalp cap
    { id: 5, indexStart: 6, indexCount: 3 },     // hairstyle variant (not default)
    { id: 101, indexStart: 9, indexCount: 3 },   // facial default
    { id: 401, indexStart: 12, indexCount: 3 },  // bare hands
    { id: 402, indexStart: 15, indexCount: 3 },  // short gloves
    { id: 903, indexStart: 18, indexCount: 3 },  // kneepads (bridges knee gap)
    { id: 1301, indexStart: 21, indexCount: 3 }, // robe
    { id: 1102, indexStart: 24, indexCount: 3 }, // underwear
  ],
};

function buildMockBinary() {
  const buf = new ArrayBuffer(96 + 54);
  const floats = new Float32Array(buf, 0, 24);
  floats.set([0, 0, 0, 0, 0, 1], 0);
  floats.set([1, 0, 0, 0, 0, 1], 6);
  floats.set([1, 1, 0, 0, 0, 1], 12);
  floats.set([0, 1, 0, 0, 0, 1], 18);
  const indices = new Uint16Array(buf, 96, 27);
  indices.set([0, 1, 2, 0, 2, 3, 1, 2, 3, 0, 1, 3, 0, 3, 2, 1, 3, 0, 0, 2, 3, 1, 0, 3, 0, 1, 3]);
  return buf;
}

beforeEach(() => {
  const mockBin = buildMockBinary();
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.endsWith('.json')) return Promise.resolve({ json: () => Promise.resolve(mockManifest) });
    if (url.endsWith('.bin')) return Promise.resolve({ arrayBuffer: () => Promise.resolve(mockBin) });
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

  it('applies Z-up to Y-up rotation', async () => {
    const group = await loadModel('/models/test');
    const mesh = group.children[0] as any;
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('defaults include body, scalp, facial, hands, kneepads, underwear — excludes other hairstyles, gloves, robe', async () => {
    const group = await loadModel('/models/test');
    const mesh = group.children[0] as any;
    // id=0(3) + id=1(3) + id=101(3) + id=401(3) + id=903(3) + id=1102(3) = 18
    // Excluded: id=5 (other hairstyle), id=402 (gloves), id=1301 (robe)
    expect(mesh.geometry.index.count).toBe(18);
  });

  it('can equip gloves by swapping geoset variant', async () => {
    const geosets = new Set([0, 1, 101, 201, 301, 402, 501, 701, 903, 1002, 1102]);
    const group = await loadModel('/models/test', geosets);
    const mesh = group.children[0] as any;
    // id=0(3) + id=1(3) + id=101(3) + id=402(3) + id=903(3) + id=1102(3) = 18
    expect(mesh.geometry.index.count).toBe(18);
  });

  it('can enable robe geoset', async () => {
    const geosets = new Set([0, 1, 101, 201, 301, 401, 501, 701, 903, 1002, 1102, 1301]);
    const group = await loadModel('/models/test', geosets);
    const mesh = group.children[0] as any;
    // id=0(3) + id=1(3) + id=101(3) + id=401(3) + id=903(3) + id=1102(3) + id=1301(3) = 21
    expect(mesh.geometry.index.count).toBe(21);
  });
});

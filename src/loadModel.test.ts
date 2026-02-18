import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadModel } from './loadModel';

// Mock manifest: body parts (< 100) + equipment geosets (>= 100)
const mockManifest = {
  vertexCount: 4,
  indexCount: 18,
  triangleCount: 6,
  vertexBufferSize: 96, // 4 vertices * 24 bytes
  indexBufferSize: 36,  // 18 indices * 2 bytes
  vertexStride: 24,
  groups: [
    { id: 0, indexStart: 0, indexCount: 3 },     // body part (always show)
    { id: 1, indexStart: 3, indexCount: 3 },     // body part (always show)
    { id: 5, indexStart: 6, indexCount: 3 },     // body part (always show)
    { id: 401, indexStart: 9, indexCount: 3 },   // bare hands (default)
    { id: 402, indexStart: 12, indexCount: 3 },  // short gloves (NOT default)
    { id: 1501, indexStart: 15, indexCount: 3 }, // cape (NOT default)
  ],
};

function buildMockBinary() {
  const buf = new ArrayBuffer(96 + 36);
  const floats = new Float32Array(buf, 0, 24);
  floats.set([0, 0, 0, 0, 0, 1], 0);
  floats.set([1, 0, 0, 0, 0, 1], 6);
  floats.set([1, 1, 0, 0, 0, 1], 12);
  floats.set([0, 1, 0, 0, 0, 1], 18);

  const indices = new Uint16Array(buf, 96, 18);
  indices.set([0, 1, 2, 0, 2, 3, 1, 2, 3, 0, 1, 3, 0, 3, 2, 1, 3, 0]);
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

  it('mesh has position and normal attributes', async () => {
    const group = await loadModel('/models/test');
    const mesh = group.children[0] as any;
    expect(mesh.geometry.getAttribute('position')).toBeDefined();
    expect(mesh.geometry.getAttribute('normal')).toBeDefined();
  });

  it('applies Z-up to Y-up rotation', async () => {
    const group = await loadModel('/models/test');
    const mesh = group.children[0] as any;
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('always includes body parts (id < 100) and default equipment', async () => {
    const group = await loadModel('/models/test');
    const mesh = group.children[0] as any;
    // Body: id=0(3) + id=1(3) + id=5(3) = 9
    // Default equipment: id=401(3) + id=501(absent) + id=701(absent) = 3
    // Excluded: id=402 (gloves), id=1501 (cape)
    expect(mesh.geometry.index.count).toBe(12);
  });

  it('excludes equipment overlays not in enabled set', async () => {
    const group = await loadModel('/models/test');
    const mesh = group.children[0] as any;
    // 12 indices = 9 body + 3 bare hands. No gloves (402) or cape (1501).
    expect(mesh.geometry.index.count).toBe(12);
  });

  it('can add equipment geosets', async () => {
    const group = await loadModel('/models/test', new Set([401, 1501]));
    const mesh = group.children[0] as any;
    // Body: 9 + bare hands: 3 + cape: 3 = 15
    expect(mesh.geometry.index.count).toBe(15);
  });

  it('can swap equipment variant', async () => {
    // Equip short gloves (402) instead of bare hands (401)
    const group = await loadModel('/models/test', new Set([402]));
    const mesh = group.children[0] as any;
    // Body: 9 + gloves: 3 = 12 (no bare hands 401, no cape)
    expect(mesh.geometry.index.count).toBe(12);
  });
});

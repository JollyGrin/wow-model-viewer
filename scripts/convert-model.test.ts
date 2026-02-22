import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const MODEL_DIR = resolve(ROOT, 'public/models/human-male');
const BIN_PATH = resolve(MODEL_DIR, 'model.bin');
const JSON_PATH = resolve(MODEL_DIR, 'model.json');

describe('convert-model output', () => {
  it('binary file exists and has expected size', () => {
    expect(existsSync(BIN_PATH)).toBe(true);
    const bin = readFileSync(BIN_PATH);
    expect(bin.byteLength).toBeGreaterThan(0);
  });

  it('manifest is valid JSON with expected fields', () => {
    const manifest = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
    expect(manifest.vertexCount).toBeGreaterThan(0);
    expect(manifest.indexCount).toBeGreaterThan(0);
    expect(manifest.triangleCount).toBe(Math.floor(manifest.indexCount / 3));
    expect(manifest.vertexStride).toBe(32);
    expect(manifest.groups.length).toBeGreaterThan(5);
  });

  it('binary size matches manifest', () => {
    const bin = readFileSync(BIN_PATH);
    const manifest = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
    expect(bin.byteLength).toBe(manifest.vertexBufferSize + manifest.indexBufferSize);
  });

  it('has expected vertex and triangle counts for HumanMale', () => {
    const manifest = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
    expect(manifest.vertexCount).toBe(4675);
    expect(manifest.triangleCount).toBe(5628);
  });

  it('all indices are within vertex range', () => {
    const manifest = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
    const bin = readFileSync(BIN_PATH);
    const indexOffset = manifest.vertexBufferSize;
    const view = new DataView(bin.buffer, bin.byteOffset + indexOffset, manifest.indexBufferSize);
    for (let i = 0; i < manifest.indexCount; i++) {
      const idx = view.getUint16(i * 2, true);
      expect(idx).toBeLessThan(manifest.vertexCount);
    }
  });

  it('first vertex has reasonable position values', () => {
    const manifest = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
    const bin = readFileSync(BIN_PATH);
    const view = new DataView(bin.buffer, bin.byteOffset, manifest.vertexBufferSize);
    const x = view.getFloat32(0, true);
    const y = view.getFloat32(4, true);
    const z = view.getFloat32(8, true);
    expect(Math.abs(x)).toBeLessThan(5);
    expect(Math.abs(y)).toBeLessThan(5);
    expect(Math.abs(z)).toBeLessThan(5);
  });

  it('groups contain known geoset IDs', () => {
    const manifest = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
    const ids = manifest.groups.map((g: any) => g.id);
    expect(ids).toContain(0);
    expect(ids.some((id: number) => id >= 1 && id <= 13)).toBe(true);
  });

  it('all 20 models have been converted', () => {
    const slugs = [
      'blood-elf-male', 'blood-elf-female', 'dwarf-male', 'dwarf-female',
      'gnome-male', 'gnome-female', 'goblin-male', 'goblin-female',
      'human-male', 'human-female', 'night-elf-male', 'night-elf-female',
      'orc-male', 'orc-female', 'scourge-male', 'scourge-female',
      'tauren-male', 'tauren-female', 'troll-male', 'troll-female',
    ];
    for (const slug of slugs) {
      const dir = resolve(ROOT, 'public/models', slug);
      expect(existsSync(resolve(dir, 'model.json')), `${slug}/model.json`).toBe(true);
      expect(existsSync(resolve(dir, 'model.bin')), `${slug}/model.bin`).toBe(true);
    }
  });
});

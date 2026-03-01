/**
 * Convert item M2 + BLP texture to web-ready format.
 *
 * Output vertex format (32 bytes per vertex):
 *   position  3×float32  12B  offset 0
 *   normal    3×float32  12B  offset 12
 *   uv        2×float32   8B  offset 24
 *
 * Output per item:
 *   public/items/{category}/{slug}/model.bin  (vertex buffer + index buffer)
 *   public/items/{category}/{slug}/model.json (manifest)
 *   public/items/{category}/{slug}/textures/main.tex
 *
 * Usage: bun run scripts/convert-item.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const { Blp, BLP_IMAGE_FORMAT } = await import('@wowserhq/format');

const ROOT = resolve(import.meta.dirname, '..');
const EXTRACT_DIR = resolve(ROOT, 'data/extracted');

interface ItemConfig {
  category: string;   // e.g. 'weapon'
  slug: string;       // e.g. 'sword-2h-claymore-b-02'
  m2Path: string;     // relative to data/extracted/
  blpPath: string;    // relative to data/extracted/
}

const ITEMS: ItemConfig[] = [
  {
    category: 'weapon',
    slug: 'sword-2h-claymore-b-02',
    m2Path: 'Item/ObjectComponents/Weapon/Sword_2H_Claymore_B_02.m2',
    blpPath: 'Item/ObjectComponents/Weapon/Sword_2H_Claymore_B_02Green.blp',
  },
];

// --- M2 Parser (adapted from convert-model.ts, accepts version 256–264) ---

interface M2Arr { count: number; ofs: number; }

function parseItemM2(buf: Buffer) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  function arr(off: number): M2Arr {
    return { count: view.getUint32(off, true), ofs: view.getUint32(off + 4, true) };
  }

  let off = 0;
  const magic = buf.toString('ascii', 0, 4); off += 4;
  if (magic !== 'MD20') throw new Error(`Bad magic: ${magic}`);

  const version = view.getUint32(off, true); off += 4;
  if (version < 256 || version > 264) throw new Error(`Unexpected version ${version} (expected 256–264)`);

  off += 8; // name M2Array
  off += 4; // globalFlags
  off += 8; // globalSequences
  off += 8; // sequences
  off += 8; // sequenceLookup
  if (version === 256) off += 8; // playableAnimLookup (v256 extra)
  off += 8; // bones
  off += 8; // keyBoneLookup
  const vertices = arr(off); off += 8;
  const views = arr(off); off += 8; // in v256 this is M2Array (8B), others uint32 (4B)

  console.log(`  M2 version ${version}: ${vertices.count} vertices, view ofs=${views.ofs}`);

  return { vertices, views, version, buf, view };
}

// Parse the embedded skin (view 0) to get submeshes and triangle indices.
// For v256 embedded skin: 32-byte submesh structs, 24-byte batch structs.
function parseItemView0(_buf: Buffer, view: DataView, viewsArr: M2Arr) {
  function arr(off: number): M2Arr {
    return { count: view.getUint32(off, true), ofs: view.getUint32(off + 4, true) };
  }

  const viewOfs = viewsArr.ofs;
  const vertexIndices = arr(viewOfs);       // skin vertex idx → model vertex idx
  const triangleIndices = arr(viewOfs + 8); // triangle index list

  // For non-v256 (separate .skin files), the view struct layout differs.
  // We only support embedded skin (v256) here.
  const submeshesArr = arr(viewOfs + 24);

  // Read vertex remap
  const remap = new Uint16Array(vertexIndices.count);
  for (let i = 0; i < vertexIndices.count; i++) {
    remap[i] = view.getUint16(vertexIndices.ofs + i * 2, true);
  }

  // Read triangle indices
  const rawTriangles = new Uint16Array(triangleIndices.count);
  for (let i = 0; i < triangleIndices.count; i++) {
    rawTriangles[i] = view.getUint16(triangleIndices.ofs + i * 2, true);
  }

  // Parse submeshes (32 bytes each for v256)
  interface Submesh { vertexStart: number; vertexCount: number; indexStart: number; indexCount: number; }
  const submeshes: Submesh[] = [];
  const SUBMESH_SIZE = 32;
  for (let s = 0; s < submeshesArr.count; s++) {
    const so = submeshesArr.ofs + s * SUBMESH_SIZE;
    submeshes.push({
      vertexStart: view.getUint16(so + 4, true),
      vertexCount: view.getUint16(so + 6, true),
      indexStart:  view.getUint16(so + 8, true),
      indexCount:  view.getUint16(so + 10, true),
    });
  }

  return { remap, rawTriangles, submeshes };
}

// --- BLP → .tex converter ---

function decodeBlp(blpPath: string): { width: number; height: number; rgba: Uint8Array } {
  const blpData = readFileSync(blpPath);
  const blp = new Blp();
  blp.load(blpData as any);
  const image = blp.getImage(0, BLP_IMAGE_FORMAT.IMAGE_ABGR8888);
  return { width: image.width, height: image.height, rgba: new Uint8Array(image.data) };
}

function writeTexFile(outPath: string, width: number, height: number, rgba: Uint8Array): number {
  const header = new Uint8Array(4);
  const headerView = new DataView(header.buffer);
  headerView.setUint16(0, width, true);
  headerView.setUint16(2, height, true);
  const output = new Uint8Array(4 + rgba.byteLength);
  output.set(header, 0);
  output.set(rgba, 4);
  writeFileSync(outPath, output);
  return output.byteLength;
}

// --- Item conversion ---

const VERTEX_STRIDE = 32; // pos(12) + normal(12) + uv(8)

function convertItem(item: ItemConfig) {
  const m2FullPath = resolve(EXTRACT_DIR, item.m2Path);
  const blpFullPath = resolve(EXTRACT_DIR, item.blpPath);
  const outDir = resolve(ROOT, 'public/items', item.category, item.slug);
  const outBin = resolve(outDir, 'model.bin');
  const outJson = resolve(outDir, 'model.json');
  const outTexDir = resolve(outDir, 'textures');
  const outTex = resolve(outTexDir, 'main.tex');

  if (!existsSync(m2FullPath)) {
    console.error(`  ERROR: M2 not found: ${m2FullPath}`);
    console.error(`  Run extract-from-mpq.ts first.`);
    process.exit(1);
  }
  if (!existsSync(blpFullPath)) {
    console.error(`  ERROR: BLP not found: ${blpFullPath}`);
    console.error(`  Run extract-from-mpq.ts first.`);
    process.exit(1);
  }

  const buf = readFileSync(m2FullPath);
  const m2 = parseItemM2(buf);
  const skin = parseItemView0(buf, m2.view, m2.views);

  // Build output vertex buffer (32 bytes per vertex).
  // M2 vertex (48 bytes): pos(3f) boneWeights(4u8) boneIndices(4u8) normal(3f) uv1(2f) uv2(2f)
  const vertexCount = skin.remap.length;
  const STRIDE_F32 = VERTEX_STRIDE / 4; // 8
  const outBuf = new Float32Array(vertexCount * STRIDE_F32);

  for (let i = 0; i < vertexCount; i++) {
    const modelIdx = skin.remap[i];
    const srcOfs = m2.vertices.ofs + modelIdx * 48;
    const o = i * STRIDE_F32;

    // Position (M2 offset 0)
    outBuf[o + 0] = m2.view.getFloat32(srcOfs + 0,  true);
    outBuf[o + 1] = m2.view.getFloat32(srcOfs + 4,  true);
    outBuf[o + 2] = m2.view.getFloat32(srcOfs + 8,  true);

    // Normal (M2 offset 20)
    outBuf[o + 3] = m2.view.getFloat32(srcOfs + 20, true);
    outBuf[o + 4] = m2.view.getFloat32(srcOfs + 24, true);
    outBuf[o + 5] = m2.view.getFloat32(srcOfs + 28, true);

    // UV (M2 offset 32)
    outBuf[o + 6] = m2.view.getFloat32(srcOfs + 32, true);
    outBuf[o + 7] = m2.view.getFloat32(srcOfs + 36, true);
  }

  // Collect ALL triangle indices (no geoset filtering for items)
  const indexBuffer = skin.rawTriangles;

  // Sanity check
  const maxIdx = Math.max(...Array.from(indexBuffer));
  if (maxIdx >= vertexCount) {
    throw new Error(`Index ${maxIdx} out of range (${vertexCount} verts)`);
  }

  // Write binary: vertex buffer + index buffer
  const vertexBytes = new Uint8Array(outBuf.buffer);
  const indexBytes = new Uint8Array(indexBuffer.buffer, indexBuffer.byteOffset, indexBuffer.byteLength);
  const binData = new Uint8Array(vertexBytes.byteLength + indexBytes.byteLength);
  binData.set(vertexBytes, 0);
  binData.set(indexBytes, vertexBytes.byteLength);

  mkdirSync(outTexDir, { recursive: true });
  writeFileSync(outBin, binData);

  const manifest = {
    vertexCount,
    indexCount: indexBuffer.length,
    triangleCount: Math.floor(indexBuffer.length / 3),
    vertexBufferSize: vertexBytes.byteLength,
    indexBufferSize: indexBytes.byteLength,
    vertexStride: VERTEX_STRIDE,
  };
  writeFileSync(outJson, JSON.stringify(manifest, null, 2));

  // Convert BLP texture
  const { width, height, rgba } = decodeBlp(blpFullPath);
  const texBytes = writeTexFile(outTex, width, height, rgba);

  return {
    vertexCount,
    triangleCount: manifest.triangleCount,
    submeshCount: skin.submeshes.length,
    binSize: binData.byteLength,
    texSize: texBytes,
    texDims: `${width}x${height}`,
  };
}

// --- Main ---

function main() {
  console.log(`Converting ${ITEMS.length} item(s)...\n`);

  for (const item of ITEMS) {
    console.log(`${item.category}/${item.slug}:`);
    const result = convertItem(item);
    console.log(`  ${result.vertexCount} verts, ${result.triangleCount} tris, ${result.submeshCount} submeshes`);
    console.log(`  model.bin: ${result.binSize}B`);
    console.log(`  main.tex: ${result.texDims} → ${result.texSize}B`);
  }

  console.log('\n=== Done ===');
}

main();

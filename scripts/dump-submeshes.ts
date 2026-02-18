/**
 * Dump raw submesh data from the M2 file to check all fields,
 * especially the 'level' field at offset 2 that we've been ignoring.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const M2_PATH = resolve(ROOT, 'data/patch/patch-3/Character/Human/Male/HumanMale.m2');

const buf = readFileSync(M2_PATH);
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

function arr(off: number) {
  return { count: view.getUint32(off, true), ofs: view.getUint32(off + 4, true) };
}

// Parse header to find views array
let off = 0;
off += 4; // magic
off += 4; // version
off += 8; // name
off += 4; // globalFlags
off += 8; // globalSequences
off += 8; // animations
off += 8; // animationLookup
off += 8; // playableAnimLookup (v256 EXTRA)
off += 8; // bones
off += 8; // keyBoneLookup
const vertices = arr(off); off += 8;
const views = arr(off); off += 8;

// Parse view 0
const viewOfs = views.ofs;
const vertexIndices = arr(viewOfs);
const triangleIndices = arr(viewOfs + 8);
// viewOfs + 16 = vertex properties
const submeshesArr = arr(viewOfs + 24);
const batchesArr = arr(viewOfs + 32);

console.log(`View 0 header:`);
console.log(`  Vertex indices: ${vertexIndices.count} at 0x${vertexIndices.ofs.toString(16)}`);
console.log(`  Triangle indices: ${triangleIndices.count} at 0x${triangleIndices.ofs.toString(16)}`);
console.log(`  Submeshes: ${submeshesArr.count} at 0x${submeshesArr.ofs.toString(16)}`);
console.log(`  Batches: ${batchesArr.count} at 0x${batchesArr.ofs.toString(16)}`);

// Dump all submesh fields (32 bytes each)
console.log(`\n=== Raw Submesh Data (${submeshesArr.count} submeshes, 32 bytes each) ===`);
console.log('Idx | meshId | level | vtxStart | vtxCount | idxStart | idxCount | boneCount | boneCbo | boneInfl | rootBone | centerXYZ');

for (let s = 0; s < submeshesArr.count; s++) {
  const so = submeshesArr.ofs + s * 32;
  const meshId = view.getUint16(so, true);
  const level = view.getUint16(so + 2, true);
  const vtxStart = view.getUint16(so + 4, true);
  const vtxCount = view.getUint16(so + 6, true);
  const idxStart = view.getUint16(so + 8, true);
  const idxCount = view.getUint16(so + 10, true);
  const boneCount = view.getUint16(so + 12, true);
  const boneCombo = view.getUint16(so + 14, true);
  const boneInfl = view.getUint16(so + 16, true);
  const rootBone = view.getUint16(so + 18, true);
  const cx = view.getFloat32(so + 20, true);
  const cy = view.getFloat32(so + 24, true);
  const cz = view.getFloat32(so + 28, true);

  const marker = meshId === 65535 ? ' (EMPTY)' : '';
  console.log(
    `${String(s).padStart(3)} | ${String(meshId).padStart(6)} | ${String(level).padStart(5)} | ` +
    `${String(vtxStart).padStart(8)} | ${String(vtxCount).padStart(8)} | ` +
    `${String(idxStart).padStart(8)} | ${String(idxCount).padStart(8)} | ` +
    `${String(boneCount).padStart(9)} | ${String(boneCombo).padStart(7)} | ` +
    `${String(boneInfl).padStart(8)} | ${String(rootBone).padStart(8)} | ` +
    `(${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)})${marker}`
  );
}

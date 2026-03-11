/**
 * Dump geoset 0 (body mesh) AND geoset 5 (hair) as OBJ files for external inspection.
 * Also dump ALL geosets combined to see if anything fills the gap.
 * Uses the raw M2 data directly (not the converted model.bin).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const m2Path = resolve(ROOT, 'data/patch/patch-6/Character/Human/Male/HumanMale.m2');
const buf = readFileSync(m2Path);
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// Parse M2 v256 header
let off = 8;
off += 8; off += 4; off += 8; off += 8; off += 8; off += 8; off += 8; off += 8;
const vertCount = view.getUint32(off, true);
const vertOfs = view.getUint32(off + 4, true);
off += 8;
const viewOfs = view.getUint32(off + 4, true);

function getVert(i: number) {
  const o = vertOfs + i * 48;
  return {
    x: view.getFloat32(o, true),
    y: view.getFloat32(o + 4, true),
    z: view.getFloat32(o + 8, true),
    nx: view.getFloat32(o + 20, true),
    ny: view.getFloat32(o + 24, true),
    nz: view.getFloat32(o + 28, true),
    u: view.getFloat32(o + 32, true),
    v: view.getFloat32(o + 36, true),
  };
}

// Parse view 0
const remapCount = view.getUint32(viewOfs, true);
const remapOfs = view.getUint32(viewOfs + 4, true);
const triIdxCount = view.getUint32(viewOfs + 8, true);
const triOfs = view.getUint32(viewOfs + 12, true);
const submeshCount = view.getUint32(viewOfs + 24, true);
const submeshOfs = view.getUint32(viewOfs + 28, true);

const remap = new Uint16Array(remapCount);
for (let i = 0; i < remapCount; i++) {
  remap[i] = view.getUint16(remapOfs + i * 2, true);
}

const tris = new Uint16Array(triIdxCount);
for (let i = 0; i < triIdxCount; i++) {
  tris[i] = view.getUint16(triOfs + i * 2, true);
}

interface Submesh { id: number; iStart: number; iCount: number; vStart: number; vCount: number; }
const submeshes: Submesh[] = [];
for (let s = 0; s < submeshCount; s++) {
  const so = submeshOfs + s * 32;
  submeshes.push({
    id: view.getUint16(so, true),
    vStart: view.getUint16(so + 4, true),
    vCount: view.getUint16(so + 6, true),
    iStart: view.getUint16(so + 8, true),
    iCount: view.getUint16(so + 10, true),
  });
}

function writeOBJ(filename: string, geosetIds: Set<number>) {
  const subs = submeshes.filter(s => geosetIds.has(s.id));

  // Collect all unique vertex indices
  const vertexSet = new Set<number>();
  for (const sub of subs) {
    for (let t = sub.iStart; t < sub.iStart + sub.iCount; t++) {
      vertexSet.add(remap[tris[t]]);
    }
  }

  // Create vertex index mapping (global -> local 1-based for OBJ)
  const vertexMap = new Map<number, number>();
  let localIdx = 1;
  const sortedVerts = [...vertexSet].sort((a, b) => a - b);
  for (const v of sortedVerts) {
    vertexMap.set(v, localIdx++);
  }

  let obj = `# M2 geosets: ${[...geosetIds].join(', ')}\n`;
  obj += `# Vertices: ${vertexMap.size}\n`;

  // Write vertices
  for (const vi of sortedVerts) {
    const v = getVert(vi);
    obj += `v ${v.x.toFixed(6)} ${v.z.toFixed(6)} ${(-v.y).toFixed(6)}\n`; // Convert to Y-up
  }

  // Write normals
  for (const vi of sortedVerts) {
    const v = getVert(vi);
    obj += `vn ${v.nx.toFixed(6)} ${v.nz.toFixed(6)} ${(-v.ny).toFixed(6)}\n`;
  }

  // Write UVs
  for (const vi of sortedVerts) {
    const v = getVert(vi);
    obj += `vt ${v.u.toFixed(6)} ${(1 - v.v).toFixed(6)}\n`; // Flip V for OBJ convention
  }

  // Write faces per geoset
  for (const sub of subs) {
    obj += `g geoset_${sub.id}\n`;
    for (let t = sub.iStart; t < sub.iStart + sub.iCount; t += 3) {
      const a = vertexMap.get(remap[tris[t]])!;
      const b = vertexMap.get(remap[tris[t + 1]])!;
      const c = vertexMap.get(remap[tris[t + 2]])!;
      obj += `f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}\n`;
    }
  }

  const outPath = resolve(ROOT, filename);
  writeFileSync(outPath, obj);
  console.log(`Wrote ${outPath} (${vertexMap.size} verts, ${subs.reduce((s, sub) => s + sub.iCount / 3, 0)} tris)`);
}

mkdirSync(resolve(ROOT, 'debug'), { recursive: true });

// Dump body mesh only
writeOBJ('debug/body-only.obj', new Set([0]));

// Dump body + default visible geosets
writeOBJ('debug/body-default.obj', new Set([0, 5, 101, 201, 301, 401, 501, 701, 1301]));

// Dump ALL geosets combined
const allIds = new Set(submeshes.map(s => s.id));
writeOBJ('debug/all-geosets.obj', allIds);

// Dump just geoset 16 (best back coverage hair)
writeOBJ('debug/hair-16.obj', new Set([16]));

// Dump body + hair 16
writeOBJ('debug/body-hair16.obj', new Set([0, 16, 101, 201, 301, 401, 501, 701, 1301]));

// Also: extract the BASE model body mesh for comparison
const basePath = resolve(ROOT, 'data/extracted/Character/Human/Male/HumanMale.m2');
try {
  const baseBuf = readFileSync(basePath);
  const baseView = new DataView(baseBuf.buffer, baseBuf.byteOffset, baseBuf.byteLength);

  let boff = 8;
  boff += 8; boff += 4; boff += 8; boff += 8; boff += 8; boff += 8; boff += 8; boff += 8;
  const bVertCount = baseView.getUint32(boff, true);
  const bVertOfs = baseView.getUint32(boff + 4, true);
  boff += 8;
  const bViewOfs = baseView.getUint32(boff + 4, true);

  const bRemapCount = baseView.getUint32(bViewOfs, true);
  const bRemapOfs = baseView.getUint32(bViewOfs + 4, true);
  const bTriCount = baseView.getUint32(bViewOfs + 8, true);
  const bTriOfs = baseView.getUint32(bViewOfs + 12, true);
  const bSubCount = baseView.getUint32(bViewOfs + 24, true);
  const bSubOfs = baseView.getUint32(bViewOfs + 28, true);

  // Compare body mesh vertices between base and patch
  // Find geoset 0 submeshes
  const baseSubs: Submesh[] = [];
  for (let s = 0; s < bSubCount; s++) {
    const so = bSubOfs + s * 32;
    const id = baseView.getUint16(so, true);
    if (id === 0) {
      baseSubs.push({
        id,
        vStart: baseView.getUint16(so + 4, true),
        vCount: baseView.getUint16(so + 6, true),
        iStart: baseView.getUint16(so + 8, true),
        iCount: baseView.getUint16(so + 10, true),
      });
    }
  }

  console.log(`\nBase model body mesh: ${baseSubs.length} submeshes, ${baseSubs.reduce((s, sub) => s + sub.iCount / 3, 0)} tris`);

  // Read base remap
  const bRemap = new Uint16Array(bRemapCount);
  for (let i = 0; i < bRemapCount; i++) {
    bRemap[i] = baseView.getUint16(bRemapOfs + i * 2, true);
  }

  // Compare vertex positions of body mesh between base and patch
  let matches = 0;
  let diffs = 0;
  for (const sub of baseSubs) {
    for (let v = sub.vStart; v < sub.vStart + sub.vCount; v++) {
      const bGlobal = bRemap[v];
      const bO = bVertOfs + bGlobal * 48;
      const bx = baseView.getFloat32(bO, true);
      const by = baseView.getFloat32(bO + 4, true);
      const bz = baseView.getFloat32(bO + 8, true);

      // Find matching vertex in patch model
      const patchSubs = submeshes.filter(s => s.id === 0);
      let found = false;
      for (const ps of patchSubs) {
        for (let pv = ps.vStart; pv < ps.vStart + ps.vCount; pv++) {
          const pGlobal = remap[pv];
          const pO = vertOfs + pGlobal * 48;
          const px = view.getFloat32(pO, true);
          const py = view.getFloat32(pO + 4, true);
          const pz = view.getFloat32(pO + 8, true);

          if (Math.abs(bx - px) < 0.001 && Math.abs(by - py) < 0.001 && Math.abs(bz - pz) < 0.001) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (found) matches++;
      else {
        diffs++;
        if (diffs <= 5) {
          console.log(`  Base vertex at (${bx.toFixed(3)}, ${by.toFixed(3)}, ${bz.toFixed(3)}) — NO MATCH in patch`);
        }
      }
    }
  }
  console.log(`Body mesh vertex comparison: ${matches} matches, ${diffs} differences`);

} catch (err: any) {
  console.log(`\nCouldn't load base model: ${err.message}`);
}

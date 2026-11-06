// Junta as pecas do carro em poucos draw calls.
//
// O modelo e montado com ~85 meshes e ~10 materiais (pintura, carbono, pneu,
// aro...). Aqui as pecas que se movem juntas viram uma malha so, com um unico
// material: a cor vai como cor de vertice e rugosidade/metal/verniz como o
// atributo aSurf. Pecas com textura, brilho animado ou transparencia ficam
// separadas. Resultado: ~90 draw calls por carro viram ~20.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();

// lite = graficos baixos: MeshStandardMaterial sem verniz (clearcoat)
export function makeSurfaceMaterial(lite = false) {
  const m = lite
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 })
    : new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 1 });
  m.name = lite ? 'carSurfaceLite' : 'carSurface';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSurf;\nvarying vec4 vSurf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = aSurf;');
    let lights = THREE.ShaderChunk.lights_physical_fragment;
    lights = lights
      .replace('material.clearcoat = clearcoat;', 'material.clearcoat = clearcoat * vSurf.z;')
      .replace('material.clearcoatRoughness = clearcoatRoughness;', 'material.clearcoatRoughness = vSurf.w;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vSurf;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurf.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;')
      .replace('#include <lights_physical_fragment>', lights);
  };
  m.customProgramCacheKey = () => m.name;
  return m;
}

function surfOf(mat) {
  return [
    mat.roughness ?? 1,
    mat.metalness ?? 0,
    mat.clearcoat ?? 0,
    mat.clearcoatRoughness ?? 0.05,
  ];
}

// troca a ordem dos vertices de cada triangulo (geometria nao indexada)
function flipWinding(g) {
  for (const attr of Object.values(g.attributes)) {
    const a = attr.array;
    const s = attr.itemSize;
    for (let t = 0; t < attr.count; t += 3) {
      for (let k = 0; k < s; k++) {
        const i1 = (t + 1) * s + k;
        const i2 = (t + 2) * s + k;
        const tmp = a[i1];
        a[i1] = a[i2];
        a[i2] = tmp;
      }
    }
  }
}

// Geometria pronta para o material unico (position, normal, color, aSurf),
// ja no espaco de `rel`. Materiais DoubleSide ganham uma copia invertida.
function bake(geometry, material, rel) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.morphAttributes = {};
  g.applyMatrix4(rel);
  if (rel.determinant() < 0) flipWinding(g);

  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const surf = new Float32Array(n * 4);
  const mats = Array.isArray(material) ? material : null;
  const groups = mats && g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
  let double = false;
  for (const gr of groups) {
    const m = mats ? mats[gr.materialIndex] : material;
    if (!m) continue;
    if (m.side === THREE.DoubleSide) double = true;
    const s = surfOf(m);
    const end = Math.min(n, gr.start + gr.count);
    for (let i = gr.start; i < end; i++) {
      col[i * 3] = m.color.r;
      col[i * 3 + 1] = m.color.g;
      col[i * 3 + 2] = m.color.b;
      surf.set(s, i * 4);
    }
  }
  g.clearGroups();
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 4));
  if (!double) return [g];
  const back = g.clone();
  flipWinding(back);
  const nrm = back.attributes.normal.array;
  for (let i = 0; i < nrm.length; i++) nrm[i] = -nrm[i];
  return [g, back];
}

const usesOnly = (mesh, allowed) => [].concat(mesh.material).every((m) => allowed.has(m));

// Junta os meshes de `parent` (e descendentes) cujos materiais estao em
// `allowed` numa malha so, filha de `parent`. `skip`: grupos que se movem
// sozinhos e nao entram. Retorna a malha nova (ou null) e os meshes removidos.
export function batchParts(parent, allowed, material, { name, castShadow = true, receiveShadow = true, skip = [] } = {}) {
  parent.updateMatrixWorld(true);
  _inv.copy(parent.matrixWorld).invert();
  const found = [];
  const walk = (o) => {
    if (o !== parent && skip.includes(o)) return;
    if (o.isMesh && !o.isInstancedMesh && usesOnly(o, allowed)) found.push(o);
    for (const c of o.children) walk(c);
  };
  walk(parent);
  if (!found.length) return { mesh: null, removed: [] };
  const parts = [];
  for (const o of found) {
    _rel.multiplyMatrices(_inv, o.matrixWorld);
    parts.push(...bake(o.geometry, o.material, _rel));
  }
  for (const o of found) o.parent.remove(o);
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  parent.add(mesh);
  return { mesh, removed: found };
}

// Barras de suspensao: um InstancedMesh por geometria. beams[i].mesh vira so
// um Object3D de transformacao (fora da cena); update() copia as matrizes.
export function instanceRods(group, beams, sourceMaterial, material) {
  const byGeo = new Map();
  for (const b of beams) {
    if (!byGeo.has(b.mesh.geometry)) byGeo.set(b.mesh.geometry, []);
    byGeo.get(b.mesh.geometry).push(b);
  }
  const removed = [];
  const meshes = [];
  for (const [geo, list] of byGeo) {
    const [g] = bake(geo, sourceMaterial, new THREE.Matrix4());
    const inst = new THREE.InstancedMesh(g, material, list.length);
    inst.name = 'suspensionRods';
    inst.castShadow = false;
    inst.receiveShadow = false;
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // as barras ficam sempre dentro do carro
    inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
    list.forEach((b, i) => {
      b.inst = inst;
      b.index = i;
      removed.push(b.mesh);
      b.mesh.parent?.remove(b.mesh);
    });
    group.add(inst);
    meshes.push(inst);
  }
  return { meshes, removed };
}

// Junta meshes irmaos com o mesmo material (ex.: os dois numeros laterais).
export function mergeSiblings(parent, material, name) {
  const list = parent.children.filter((o) => o.isMesh && o.material === material);
  if (list.length < 2) return null;
  const geos = list.map((o) => {
    o.updateMatrix();
    return o.geometry.clone().applyMatrix4(o.matrix);
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), material);
  for (const g of geos) g.dispose();
  mesh.name = name;
  mesh.castShadow = list[0].castShadow;
  mesh.receiveShadow = list[0].receiveShadow;
  mesh.renderOrder = list[0].renderOrder;
  for (const o of list) parent.remove(o);
  parent.add(mesh);
  return { mesh, removed: list };
}

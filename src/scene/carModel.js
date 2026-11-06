// Modelo procedural do carro (monoposto estilo "Stadium" do TrackMania Nations Forever).
//
// Convencao local (a mesma da fisica):
//   +Z = frente (bico), +Y = cima, +X = lado ESQUERDO do carro. Unidades em metros.
//   Origem do `group` = centro de massa. Em repouso o chao fica em y = -0.56.
//
// Nada de assets externos: tudo e geometria do three.js. Texturas em canvas
// (numero e letreiro dos pneus) so sao criadas quando existe `document`, para o
// modulo funcionar tambem em node (testes headless).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeSurfaceMaterial, batchParts, instanceRods, mergeSiblings } from './carBatch.js';

// Graficos baixos: material sem verniz e sem o letreiro dos pneus.
let defaultLite = false;
export function setCarLite(v) {
  defaultLite = !!v;
}

const WHEEL_RADIUS = 0.38;
const FRONT_TYRE_WIDTH = 0.32;
const REAR_TYRE_WIDTH = 0.42;

// Layout das rodas compartilhado entre fisica e visual (centro da roda em repouso).
// 0 = dianteira esquerda, 1 = dianteira direita, 2 = traseira esquerda, 3 = traseira direita.
export const CAR_WHEELS = [
  { x: 0.92, y: -0.18, z: 1.62, radius: WHEEL_RADIUS, width: FRONT_TYRE_WIDTH, steer: true },
  { x: -0.92, y: -0.18, z: 1.62, radius: WHEEL_RADIUS, width: FRONT_TYRE_WIDTH, steer: true },
  { x: 0.92, y: -0.18, z: -1.28, radius: WHEEL_RADIUS, width: REAR_TYRE_WIDTH, steer: false },
  { x: -0.92, y: -0.18, z: -1.28, radius: WHEEL_RADIUS, width: REAR_TYRE_WIDTH, steer: false },
];

const HAS_DOM = typeof document !== 'undefined';
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Secoes de carroceria (superelipses ao longo de Z).
//   w = largura total, top/bottom = y do topo/fundo, n = expoente (2 = elipse,
//   maior = mais "quadrado"), cx = deslocamento lateral do centro.
// ---------------------------------------------------------------------------
const BODY_SECTIONS = [
  { z: 2.55, w: 0.1, top: -0.235, bottom: -0.325, n: 2.4 },
  { z: 2.46, w: 0.22, top: -0.165, bottom: -0.35, n: 2.6 },
  { z: 2.2, w: 0.31, top: -0.1, bottom: -0.36, n: 3 },
  { z: 1.8, w: 0.4, top: -0.01, bottom: -0.365, n: 3.2 },
  { z: 1.4, w: 0.5, top: 0.065, bottom: -0.38, n: 3.6 },
  { z: 1.0, w: 0.62, top: 0.125, bottom: -0.4, n: 4 },
  { z: 0.6, w: 0.7, top: 0.16, bottom: -0.405, n: 4.4 },
  { z: 0.2, w: 0.74, top: 0.155, bottom: -0.405, n: 4.6 },
  { z: -0.2, w: 0.76, top: 0.15, bottom: -0.405, n: 4.6 },
  { z: -0.55, w: 0.76, top: 0.17, bottom: -0.405, n: 4.4 },
  { z: -0.95, w: 0.66, top: 0.17, bottom: -0.4, n: 4 },
  { z: -1.3, w: 0.48, top: 0.11, bottom: -0.37, n: 3.6 },
  { z: -1.65, w: 0.32, top: 0.04, bottom: -0.3, n: 3.2 },
  { z: -1.9, w: 0.24, top: -0.02, bottom: -0.26, n: 3 },
];

// Tomada de ar / santo antonio atras do piloto.
const AIRBOX_SECTIONS = [
  { z: -0.32, w: 0.27, top: 0.515, bottom: 0.0, n: 3 },
  { z: -0.45, w: 0.3, top: 0.555, bottom: 0.0, n: 3 },
  { z: -0.8, w: 0.29, top: 0.49, bottom: 0.0, n: 3 },
  { z: -1.15, w: 0.23, top: 0.35, bottom: 0.0, n: 2.8 },
  { z: -1.5, w: 0.15, top: 0.2, bottom: 0.0, n: 2.6 },
  { z: -1.76, w: 0.09, top: 0.09, bottom: 0.0, n: 2.4 },
];

// Sidepod esquerdo (o direito e espelhado).
const POD_SECTIONS = [
  { z: 0.5, cx: 0.455, w: 0.33, top: 0.03, bottom: -0.37, n: 4 },
  { z: 0.36, cx: 0.465, w: 0.37, top: 0.075, bottom: -0.395, n: 4 },
  { z: 0.0, cx: 0.465, w: 0.38, top: 0.09, bottom: -0.4, n: 4 },
  { z: -0.45, cx: 0.445, w: 0.36, top: 0.05, bottom: -0.4, n: 3.8 },
  { z: -0.85, cx: 0.4, w: 0.28, top: -0.03, bottom: -0.39, n: 3.4 },
  { z: -1.15, cx: 0.33, w: 0.17, top: -0.11, bottom: -0.37, n: 3 },
];
const POD_SECTIONS_RIGHT = POD_SECTIONS.map((s) => ({ ...s, cx: -s.cx }));

// Perfis laterais (z, y) de placas finas.
const FRONT_ENDPLATE = [[2.57, -0.5], [2.57, -0.43], [2.42, -0.3], [2.04, -0.26], [2.04, -0.5]];
const NOSE_PYLON = [[2.47, -0.45], [2.27, -0.44], [2.3, -0.34], [2.47, -0.32]];
const REAR_ENDPLATE = [[-1.7, 0.1], [-1.73, 0.58], [-2.1, 0.58], [-2.18, 0.42], [-2.1, 0.1]];
const REAR_PYLON = [[-1.52, 0.02], [-1.7, -0.02], [-1.93, 0.37], [-1.81, 0.4]];

// ---------------------------------------------------------------------------
// Helpers de geometria
// ---------------------------------------------------------------------------
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function xf(geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  _m4.compose(_p.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
  geo.applyMatrix4(_m4);
  return geo;
}

// Junta geometrias (todas viram nao-indexadas com position/normal/uv).
function merge(geos) {
  const list = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    if (!n.attributes.normal) n.computeVertexNormals();
    if (!n.attributes.uv) {
      n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    }
    for (const k of Object.keys(n.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    }
    n.clearGroups();
    return n;
  });
  const out = mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  return out;
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

const SECTION_KEYS = ['z', 'w', 'top', 'bottom', 'n', 'cx'];

// Interpola as secoes de controle (Catmull-Rom) com passo ~`step` em Z.
function sampleSections(ctrl, step = 0.05) {
  const c = ctrl.map((s) => ({ cx: 0, n: 2, ...s })).sort((a, b) => a.z - b.z);
  const out = [];
  for (let i = 0; i < c.length - 1; i++) {
    const p0 = c[Math.max(i - 1, 0)];
    const p1 = c[i];
    const p2 = c[i + 1];
    const p3 = c[Math.min(i + 2, c.length - 1)];
    const steps = Math.max(2, Math.ceil((p2.z - p1.z) / step));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const s = {};
      for (const key of SECTION_KEYS) s[key] = catmull(p0[key], p1[key], p2[key], p3[key], t);
      s.w = Math.max(s.w, 0.01);
      s.n = Math.max(s.n, 1.5);
      if (s.top - s.bottom < 0.01) s.top = s.bottom + 0.01;
      out.push(s);
    }
  }
  out.push({ ...c[c.length - 1] });
  return out;
}

function superPoint(s, theta) {
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  const e = 2 / s.n;
  const x = s.cx + (s.w / 2) * Math.sign(c) * Math.pow(Math.abs(c), e);
  const y = (s.top + s.bottom) / 2 + ((s.top - s.bottom) / 2) * Math.sign(sn) * Math.pow(Math.abs(sn), e);
  return [x, y];
}

// Altura da superficie superior da secao em u = (x - cx) / (w/2).
function superTop(s, u) {
  const a = Math.min(Math.abs(u), 0.97);
  return (s.top + s.bottom) / 2 + ((s.top - s.bottom) / 2) * Math.pow(1 - Math.pow(a, s.n), 1 / s.n);
}

// Casco fechado por superelipses. Grupos: 0 = lateral, 1 = tampa frontal (z max), 2 = tampa traseira.
function loftGeometry(ctrl, { around = 40, step = 0.05 } = {}) {
  const secs = sampleSections(ctrl, step);
  const R = secs.length;
  const M = around;
  const pos = [];
  const idx = [];
  for (const s of secs) {
    for (let j = 0; j < M; j++) {
      const [x, y] = superPoint(s, (j / M) * TAU);
      pos.push(x, y, s.z);
    }
  }
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * M + j;
      const b = i * M + ((j + 1) % M);
      const c = (i + 1) * M + ((j + 1) % M);
      const d = (i + 1) * M + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  const sideCount = idx.length;
  const cap = (ring, front) => {
    const s = secs[ring];
    const center = pos.length / 3;
    pos.push(s.cx, (s.top + s.bottom) / 2, s.z);
    const base = pos.length / 3;
    for (let j = 0; j < M; j++) pos.push(pos[(ring * M + j) * 3], pos[(ring * M + j) * 3 + 1], s.z);
    for (let j = 0; j < M; j++) {
      const v0 = base + j;
      const v1 = base + ((j + 1) % M);
      if (front) idx.push(center, v0, v1);
      else idx.push(center, v1, v0);
    }
  };
  cap(R - 1, true);
  cap(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.addGroup(0, sideCount, 0);
  g.addGroup(sideCount, M * 3, 1);
  g.addGroup(sideCount + M * 3, M * 3, 2);
  g.computeVertexNormals();
  return g;
}

// Faixa de pintura colada no topo de um casco (u0..u1 relativos a meia largura).
function stripGeometry(ctrl, u0, u1, zMin, zMax, { lift = 0.004, across = 4, step = 0.05 } = {}) {
  const secs = sampleSections(ctrl, step).filter((s) => s.z >= zMin - 1e-6 && s.z <= zMax + 1e-6);
  const K = across + 1;
  const pos = [];
  const idx = [];
  for (const s of secs) {
    for (let k = 0; k < K; k++) {
      const u = u0 + ((u1 - u0) * k) / across;
      pos.push(s.cx + (u * s.w) / 2, superTop(s, u) + lift, s.z);
    }
  }
  for (let i = 0; i < secs.length - 1; i++) {
    for (let k = 0; k < across; k++) {
      const a = i * K + k;
      const b = a + 1;
      const d = a + K;
      const c = d + 1;
      idx.push(a, d, c, a, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Perfil aerodinamico invertido (gera downforce). px cresce para tras.
function airfoilShape(chord, { t = 0.12, camber = 0.04, aoa = 0, n = 14 } = {}) {
  const up = [];
  const lo = [];
  for (let i = 0; i <= n; i++) {
    const xn = (1 - Math.cos((Math.PI * i) / n)) / 2;
    const yt = 5 * t * (0.2969 * Math.sqrt(xn) - 0.126 * xn - 0.3516 * xn ** 2 + 0.2843 * xn ** 3 - 0.1036 * xn ** 4);
    const yc = -camber * 4 * xn * (1 - xn);
    up.push([xn * chord, (yc + yt) * chord]);
    lo.push([xn * chord, (yc - yt) * chord]);
  }
  const pts = [...up];
  for (let i = n - 1; i >= 1; i--) pts.push(lo[i]);
  const ca = Math.cos(aoa);
  const sa = Math.sin(aoa);
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * ca - y * sa, x * sa + y * ca)));
}

// Elemento de asa: bordo de ataque em (z, y) = lead, envergadura centrada em X.
function wingGeometry(chord, span, opts, lead) {
  const g = new THREE.ExtrudeGeometry(airfoilShape(chord, opts), { depth: span, bevelEnabled: false });
  g.rotateY(Math.PI / 2); // px -> -z, extrusao -> +x
  g.translate(-span / 2, lead[1], lead[0]);
  return g;
}

// Placa fina definida por perfil lateral [[z, y], ...], centrada em x.
function plateGeometry(pts, thickness, x, bevel = 0.004) {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
  });
  g.rotateY(Math.PI / 2);
  g.translate(x - thickness / 2, 0, 0);
  return g;
}

function rodGeometry(a, b, r, seg = 6) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const g = new THREE.CylinderGeometry(r, r, dir.length(), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
  return g;
}

// ---------------------------------------------------------------------------
// Rodas
// ---------------------------------------------------------------------------
const RIM_RADIUS = 0.255;
const LETTER_IN = 0.293;
const LETTER_OUT = 0.335;

function tyreGeometry(w) {
  const h = w / 2;
  const R = WHEEL_RADIUS;
  const prof = [
    [0.25, -h * 0.92], [0.3, -h], [0.34, -h * 0.98], [0.362, -h * 0.93], [0.375, -h * 0.84], [R, -h * 0.66],
    [R, h * 0.66], [0.375, h * 0.84], [0.362, h * 0.93], [0.34, h * 0.98], [0.3, h], [0.25, h * 0.92],
  ];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 40);
  g.rotateZ(Math.PI / 2); // eixo da roda = X
  return g;
}

// Aro com raios: face vazada (Extrude com furos) + tambor.
function rimGeometry(w) {
  const spokes = 10;
  const R = 0.245;
  const rO = 0.215;
  const rI = 0.085;
  const sector = TAU / spokes;
  const hwO = 0.019 / rO;
  const hwI = 0.016 / rI;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, R, 0, TAU, false);
  for (let i = 0; i < spokes; i++) {
    const a0 = i * sector;
    const hole = new THREE.Path();
    hole.moveTo(rO * Math.cos(a0 + hwO), rO * Math.sin(a0 + hwO));
    hole.absarc(0, 0, rO, a0 + hwO, a0 + sector - hwO, false);
    hole.lineTo(rI * Math.cos(a0 + sector - hwI), rI * Math.sin(a0 + sector - hwI));
    hole.absarc(0, 0, rI, a0 + sector - hwI, a0 + hwI, true);
    hole.closePath();
    shape.holes.push(hole);
  }
  const face = new THREE.ExtrudeGeometry(shape, {
    depth: 0.022,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.005,
    bevelSegments: 2,
    curveSegments: 6,
  });
  face.translate(0, 0, -0.011);
  face.rotateY(Math.PI / 2); // face externa aponta para +X
  face.translate(w / 2 - 0.05, 0, 0);
  const barrel = new THREE.CylinderGeometry(RIM_RADIUS, RIM_RADIUS, w * 0.82, 36, 1, true);
  barrel.rotateZ(Math.PI / 2);
  const lip = new THREE.TorusGeometry(0.252, 0.008, 6, 40);
  lip.rotateY(Math.PI / 2);
  lip.translate(w / 2 - 0.035, 0, 0);
  return merge([face, barrel, lip]);
}

function ringPair(rIn, rOut, x, seg = 48) {
  const a = new THREE.RingGeometry(rIn, rOut, seg, 1);
  a.rotateY(Math.PI / 2);
  a.translate(x, 0, 0);
  const b = new THREE.RingGeometry(rIn, rOut, seg, 1);
  b.rotateY(-Math.PI / 2);
  b.translate(-x, 0, 0);
  return merge([a, b]);
}

function buildWheelGeometries(w) {
  const h = w / 2;
  const nut = new THREE.CylinderGeometry(0.038, 0.048, 0.05, 12);
  nut.rotateZ(-Math.PI / 2); // ponta estreita para +X (fora)
  nut.translate(h - 0.03, 0, 0);
  const disc = new THREE.CylinderGeometry(0.17, 0.17, 0.028, 28);
  disc.rotateZ(Math.PI / 2);
  disc.translate(-w * 0.18, 0, 0);
  const caliper = new THREE.BoxGeometry(0.06, 0.1, 0.11);
  caliper.rotateX(-0.6);
  caliper.translate(-w * 0.18, 0.13, -0.09);
  const blur = new THREE.CircleGeometry(0.236, 32);
  blur.rotateY(Math.PI / 2);
  blur.translate(h - 0.025, 0, 0);
  return {
    tyre: tyreGeometry(w),
    band: ringPair(0.338, 0.346, h * 0.985 + 0.003),
    letters: ringPair(LETTER_IN, LETTER_OUT, h + 0.003),
    rim: rimGeometry(w),
    nut,
    disc,
    caliper,
    blur,
  };
}

// ---------------------------------------------------------------------------
// Texturas em canvas (somente no navegador)
// ---------------------------------------------------------------------------
function canvasTexture(size, draw) {
  if (!HAS_DOM) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function cssColor(hex) {
  return `#${new THREE.Color(hex).getHexString()}`;
}

function numberTexture(text, ringColor) {
  return canvasTexture(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.47, 0, TAU);
    ctx.fill();
    ctx.lineWidth = s * 0.05;
    ctx.strokeStyle = ringColor;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.4, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#111111';
    ctx.font = `italic 900 ${Math.round(s * 0.6)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, s / 2, s * 0.53);
  });
}

function tyreLetteringTexture() {
  return canvasTexture(1024, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const c = s / 2;
    // UV do RingGeometry: (x / raioExterno + 1) / 2 -> raio em px = r / LETTER_OUT * c
    const rText = (((LETTER_IN + LETTER_OUT) / 2) / LETTER_OUT) * c;
    const label = '  STADIUM  \u2022  SLICK 380  \u2022'.repeat(2);
    const step = TAU / label.length;
    ctx.fillStyle = '#e6e6e6';
    ctx.font = `bold ${Math.round(s * 0.05)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < label.length; i++) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(i * step);
      ctx.translate(0, -rText);
      ctx.fillText(label[i], 0, 0);
      ctx.restore();
    }
  });
}

// ---------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------
export function createCarModel(options = {}) {
  const { bodyColor = 0x1e6bff, accentColor = 0xffffff, secondaryColor = 0xff2a2a, number = '1', lite = defaultLite } = options;

  const group = new THREE.Group();
  group.name = 'car';

  // --- materiais compartilhados ---
  const paint = (color) =>
    new THREE.MeshPhysicalMaterial({ color, metalness: 0.3, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 });
  const mats = {
    paint: paint(bodyColor),
    accent: paint(accentColor),
    secondary: paint(secondaryColor),
    carbon: new THREE.MeshPhysicalMaterial({
      color: 0x17191d, metalness: 0.4, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3,
    }),
    inlet: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.85, metalness: 0.1 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.85, roughness: 0.28, side: THREE.DoubleSide }),
    disc: new THREE.MeshStandardMaterial({ color: 0x3b3d42, metalness: 0.7, roughness: 0.45 }),
    driver: new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.8 }),
    visor: new THREE.MeshPhysicalMaterial({
      color: 0x0b0f18, metalness: 0.6, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02,
    }),
    brake: new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xff1a12, emissiveIntensity: 0.15, roughness: 0.4 }),
    exhaust: new THREE.MeshStandardMaterial({
      color: 0x4a4a4a, metalness: 0.8, roughness: 0.35, emissive: 0xff5a10, emissiveIntensity: 0, side: THREE.DoubleSide,
    }),
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff7a1a, emissiveIntensity: 0.3 }),
    flameOuter: new THREE.MeshBasicMaterial({
      color: 0xff7a1a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }),
    flameInner: new THREE.MeshBasicMaterial({
      color: 0x8cc4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }),
    blur: new THREE.MeshStandardMaterial({
      color: 0xb4bac2, metalness: 0.7, roughness: 0.45, transparent: true, opacity: 0, depthWrite: false,
    }),
  };
  const lettersTex = lite ? null : tyreLetteringTexture();
  if (lettersTex) {
    mats.letters = new THREE.MeshStandardMaterial({ map: lettersTex, roughness: 0.8, alphaTest: 0.35 });
  }
  const numberTex = numberTexture(String(number), cssColor(secondaryColor));
  if (numberTex) {
    mats.decal = new THREE.MeshStandardMaterial({
      map: numberTex, roughness: 0.35, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
  }

  const add = (geo, mat, parent, { cast = true, receive = true, name } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    if (name) m.name = name;
    parent.add(m);
    return m;
  };

  // ======================= CARROCERIA =======================
  const body = new THREE.Group();
  body.name = 'body';
  group.add(body);

  // monocoque + bico + tampa do motor (tampa traseira = caixa de cambio em carbono)
  add(loftGeometry(BODY_SECTIONS, { around: 44 }), [mats.paint, mats.paint, mats.carbon], body, { name: 'monocoque' });
  add(loftGeometry(AIRBOX_SECTIONS, { around: 32 }), mats.paint, body, { name: 'airbox' });

  // sidepods (frente = entrada do radiador escura)
  const podGeo = loftGeometry(POD_SECTIONS, { around: 36 });
  add(podGeo, [mats.paint, mats.inlet, mats.paint], body, { name: 'sidepodL' });
  add(podGeo, [mats.paint, mats.inlet, mats.paint], body, { name: 'sidepodR' }).scale.x = -1;

  // abertura do cockpit + boca da tomada de ar
  const intake = new THREE.CylinderGeometry(1, 1, 0.012, 28);
  intake.rotateX(Math.PI / 2);
  add(
    merge([
      xf(new THREE.CylinderGeometry(1, 1, 0.02, 32), { p: [0, 0.147, 0.1], s: [0.25, 1, 0.42] }),
      xf(intake, { p: [0, 0.425, -0.316], s: [0.095, 0.072, 1] }),
    ]),
    mats.inlet, body, { name: 'openings' },
  );

  // assoalho
  {
    const outline = [
      [0.22, 1.15], [0.3, 0.95], [0.6, 0.56], [0.655, 0.42], [0.655, -0.55], [0.62, -0.86], [0.55, -0.98], [0.55, -1.58],
    ];
    const pts = [
      ...outline.map(([x, z]) => new THREE.Vector2(x, z)),
      ...outline.slice().reverse().map(([x, z]) => new THREE.Vector2(-x, z)),
    ];
    const floor = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
      depth: 0.03, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1,
    });
    floor.rotateX(Math.PI / 2); // forma (x, z), espessura para baixo
    floor.translate(0, -0.408, 0);
    add(floor, mats.carbon, body, { name: 'floor' });
  }

  // difusor com aletas
  {
    const ang = Math.atan2(0.21, 0.45);
    const len = Math.hypot(0.21, 0.45);
    const c = [0, -0.325, -1.775];
    const parts = [xf(new THREE.BoxGeometry(1.1, 0.014, len), { p: c, r: [ang, 0, 0] })];
    for (const x of [-0.54, -0.3, -0.1, 0.1, 0.3, 0.54]) {
      const hgt = Math.abs(x) > 0.5 ? 0.1 : 0.075;
      parts.push(
        xf(new THREE.BoxGeometry(0.012, hgt, len * 0.95), {
          p: [x, c[1] - (hgt / 2) * Math.cos(ang), c[2] - (hgt / 2) * Math.sin(ang)],
          r: [ang, 0, 0],
        }),
      );
    }
    add(merge(parts), mats.carbon, body, { name: 'diffuser' });
  }

  // asa dianteira: plano principal + 2 flaps, endplates e pilones do bico
  add(
    merge([
      wingGeometry(0.3, 2.0, { t: 0.09, camber: 0.04, aoa: 0.07 }, [2.52, -0.47]),
      wingGeometry(0.2, 2.0, { t: 0.1, camber: 0.05, aoa: 0.31 }, [2.3, -0.425]),
      wingGeometry(0.13, 2.0, { t: 0.1, camber: 0.05, aoa: 0.56 }, [2.15, -0.35]),
    ]),
    mats.paint, body, { name: 'frontWing' },
  );
  add(merge([plateGeometry(FRONT_ENDPLATE, 0.014, 1.0), plateGeometry(FRONT_ENDPLATE, 0.014, -1.0)]), mats.secondary, body, {
    name: 'frontEndplates',
  });
  add(merge([plateGeometry(NOSE_PYLON, 0.018, 0.07), plateGeometry(NOSE_PYLON, 0.018, -0.07)]), mats.carbon, body, {
    name: 'nosePylons',
  });

  // asa traseira
  add(wingGeometry(0.26, 1.2, { t: 0.12, camber: 0.05, aoa: 0.21 }, [-1.78, 0.37]), mats.paint, body, { name: 'rearWingMain' });
  add(wingGeometry(0.17, 1.2, { t: 0.1, camber: 0.05, aoa: 0.61 }, [-1.995, 0.455]), mats.accent, body, { name: 'rearWingFlap' });
  add(merge([plateGeometry(REAR_ENDPLATE, 0.016, 0.6), plateGeometry(REAR_ENDPLATE, 0.016, -0.6)]), mats.secondary, body, {
    name: 'rearEndplates',
  });
  add(
    merge([
      plateGeometry(REAR_PYLON, 0.018, 0.08),
      plateGeometry(REAR_PYLON, 0.018, -0.08),
      wingGeometry(0.13, 0.84, { t: 0.12, camber: 0.04, aoa: 0.28 }, [-1.86, 0.17]), // beam wing
    ]),
    mats.carbon, body, { name: 'rearPylons' },
  );

  // luz de freio / chuva
  add(xf(new THREE.BoxGeometry(0.16, 0.06, 0.02), { p: [0, -0.13, -1.91] }), mats.brake, body, { name: 'brakeLight' });

  // escapamento + chama do turbo
  const exhaustZ = -1.98;
  {
    const pipe = new THREE.CylinderGeometry(0.046, 0.05, 0.16, 16, 1, true);
    pipe.rotateX(Math.PI / 2);
    pipe.translate(0, 0.035, -1.9);
    add(pipe, mats.exhaust, body, { name: 'exhaust' });
    const disk = new THREE.CircleGeometry(0.044, 16);
    disk.rotateY(Math.PI);
    disk.translate(0, 0.035, -1.95);
    add(disk, mats.glow, body, { cast: false, name: 'exhaustGlow' });
  }
  const flameGeo = (r) => {
    const g = new THREE.ConeGeometry(r, 1, 14, 1, true);
    g.rotateX(-Math.PI / 2); // ponta para -Z
    g.translate(0, 0, -0.5); // base em z = 0
    return g;
  };
  const flame = new THREE.Group();
  flame.name = 'flame';
  flame.position.set(0, 0.035, exhaustZ);
  flame.visible = false;
  body.add(flame);
  const flameOuter = add(flameGeo(0.044), mats.flameOuter, flame, { cast: false, receive: false });
  const flameInner = add(flameGeo(0.024), mats.flameInner, flame, { cast: false, receive: false });
  flameOuter.renderOrder = 2;
  flameInner.renderOrder = 3;

  // piloto
  {
    const hp = [0, 0.235, -0.1];
    const hs = [0.95, 0.98, 1.06];
    add(xf(new THREE.SphereGeometry(0.125, 28, 20), { p: hp, s: hs }), mats.accent, body, { name: 'helmet' });
    add(
      xf(new THREE.SphereGeometry(0.1275, 24, 8, Math.PI / 2 - 0.95, 1.9, 1.22, 0.42), { p: hp, s: hs }),
      mats.visor, body, { name: 'visor' },
    );
    add(
      merge([
        xf(new THREE.SphereGeometry(0.1268, 6, 12, Math.PI / 2 - 0.13, 0.26, 0, 1.18), { p: hp, s: hs }),
        xf(new THREE.SphereGeometry(0.1268, 6, 16, (3 * Math.PI) / 2 - 0.13, 0.26, 0, 1.75), { p: hp, s: hs }),
      ]),
      mats.paint, body, { name: 'helmetStripe' },
    );
    add(xf(new THREE.SphereGeometry(0.1266, 32, 3, 0, TAU, 1.06, 0.08), { p: hp, s: hs }), mats.secondary, body, {
      name: 'helmetRing',
    });
    add(xf(new THREE.SphereGeometry(1, 16, 10), { p: [0, 0.14, -0.14], s: [0.21, 0.07, 0.12] }), mats.driver, body, {
      name: 'shoulders',
    });
  }

  // halo
  {
    const curve = new THREE.CatmullRomCurve3(
      [
        [0.2, 0.155, -0.4], [0.24, 0.3, -0.15], [0.17, 0.36, 0.15], [0, 0.372, 0.3],
        [-0.17, 0.36, 0.15], [-0.24, 0.3, -0.15], [-0.2, 0.155, -0.4],
      ].map((p) => new THREE.Vector3(...p)),
    );
    add(
      merge([new THREE.TubeGeometry(curve, 48, 0.021, 8, false), rodGeometry([0, 0.36, 0.29], [0, 0.13, 0.6], 0.022, 8)]),
      mats.carbon, body, { name: 'halo' },
    );
  }

  // retrovisores
  {
    const parts = [];
    for (const s of [1, -1]) {
      parts.push(xf(new THREE.BoxGeometry(0.12, 0.05, 0.045), { p: [s * 0.37, 0.215, 0.4], r: [0, s * 0.12, 0] }));
      parts.push(rodGeometry([s * 0.27, 0.12, 0.43], [s * 0.35, 0.21, 0.405], 0.009, 6));
    }
    add(merge(parts), mats.paint, body, { name: 'mirrors' });
  }

  // faixas de pintura
  add(
    merge([
      stripGeometry(BODY_SECTIONS, 0.16, 0.3, 0.62, 2.48),
      stripGeometry(BODY_SECTIONS, -0.3, -0.16, 0.62, 2.48),
      stripGeometry(BODY_SECTIONS, 0.4, 0.52, -1.1, -0.36),
      stripGeometry(BODY_SECTIONS, -0.52, -0.4, -1.1, -0.36),
    ]),
    mats.accent, body, { cast: false, name: 'accentStripes' },
  );
  add(
    merge([
      stripGeometry(AIRBOX_SECTIONS, -0.22, 0.22, -1.7, -0.33),
      stripGeometry(POD_SECTIONS, 0.25, 0.55, -1.0, 0.48),
      stripGeometry(POD_SECTIONS_RIGHT, -0.55, -0.25, -1.0, 0.48),
    ]),
    mats.secondary, body, { cast: false, name: 'secondaryStripes' },
  );

  // numero nas laterais da tomada de ar (so no navegador)
  if (mats.decal) {
    for (const s of [1, -1]) {
      const g = new THREE.PlaneGeometry(0.17, 0.17);
      g.rotateY((s * Math.PI) / 2);
      g.translate(s * 0.156, 0.27, -0.74);
      add(g, mats.decal, body, { cast: false, name: 'numberDecal' });
    }
  }

  // ======================= RODAS =======================
  const wheelGeoCache = new Map();
  const wheels = CAR_WHEELS.map((def, i) => {
    if (!wheelGeoCache.has(def.width)) wheelGeoCache.set(def.width, buildWheelGeometries(def.width));
    const geo = wheelGeoCache.get(def.width);
    const side = Math.sign(def.x);

    const root = new THREE.Group(); // segue a suspensao
    root.name = `wheel${i}`;
    root.position.set(def.x, def.y, def.z);
    const pivot = new THREE.Group(); // esterçamento (rotation.y)
    root.add(pivot);
    const fixed = new THREE.Group(); // pecas que nao giram (pinca), espelhadas p/ o lado
    fixed.scale.x = side;
    pivot.add(fixed);
    const spin = new THREE.Group(); // rolagem (rotation.x)
    pivot.add(spin);
    const spinM = new THREE.Group();
    spinM.scale.x = side; // face externa do aro sempre para fora
    spin.add(spinM);

    add(geo.tyre, mats.tyre, spinM, { name: 'tyre' });
    add(geo.band, mats.secondary, spinM, { cast: false, name: 'tyreBand' });
    if (mats.letters) add(geo.letters, mats.letters, spinM, { cast: false, name: 'tyreLetters' });
    add(geo.rim, mats.rim, spinM, { name: 'rim' });
    add(geo.nut, mats.secondary, spinM, { name: 'hubNut' });
    add(geo.disc, mats.disc, spinM, { name: 'brakeDisc' });
    const blur = add(geo.blur, mats.blur, spinM, { cast: false, receive: false, name: 'rimBlur' });
    blur.renderOrder = 1;
    add(geo.caliper, mats.secondary, fixed, { name: 'caliper' });

    group.add(root);
    return { def, side, root, pivot, spin, base: root.position.clone() };
  });

  // ======================= SUSPENSAO =======================
  // a = ponto no chassi, o = deslocamento a partir do cubo da roda.
  const rodThin = new THREE.CylinderGeometry(0.014, 0.014, 1, 6);
  const rodThick = new THREE.CylinderGeometry(0.026, 0.026, 1, 8);
  const beams = [];
  wheels.forEach((wh, wi) => {
    const s = wh.side;
    const z = wh.def.z;
    const layout = wh.def.steer
      ? [
          { a: [s * 0.12, -0.03, z + 0.26], o: [-s * 0.11, 0.11, 0] },
          { a: [s * 0.18, -0.03, z - 0.26], o: [-s * 0.11, 0.11, 0] },
          { a: [s * 0.14, -0.31, z + 0.3], o: [-s * 0.11, -0.12, 0] },
          { a: [s * 0.19, -0.33, z - 0.3], o: [-s * 0.11, -0.12, 0] },
          { a: [s * 0.14, 0.0, z - 0.05], o: [-s * 0.12, -0.09, 0] }, // pushrod
          { a: [s * 0.16, -0.17, z + 0.18], o: [-s * 0.1, -0.01, 0.11] }, // barra de direcao
        ]
      : [
          { a: [s * 0.2, 0.0, z + 0.23], o: [-s * 0.13, 0.12, 0] },
          { a: [s * 0.14, 0.0, z - 0.27], o: [-s * 0.13, 0.12, 0] },
          { a: [s * 0.22, -0.32, z + 0.28], o: [-s * 0.13, -0.12, 0] },
          { a: [s * 0.1, -0.28, z - 0.32], o: [-s * 0.13, -0.12, 0] },
          { a: [s * 0.12, -0.16, z], o: [-s * 0.1, 0, 0], thick: true }, // semieixo
        ];
    for (const l of layout) {
      const mesh = add(l.thick ? rodThick : rodThin, mats.carbon, group, { receive: false, name: 'suspension' });
      beams.push({ mesh, wheel: wi, a: new THREE.Vector3(...l.a), o: new THREE.Vector3(...l.o) });
    }
  });

  // ======================= DRAW CALLS =======================
  // pecas que andam juntas viram uma malha so com o material unico
  const surface = makeSurfaceMaterial(lite);
  const solid = new Set([
    mats.paint, mats.accent, mats.secondary, mats.carbon, mats.inlet, mats.tyre, mats.rim, mats.disc, mats.driver, mats.visor,
  ]);
  const removed = [];
  const keep = (r) => r && removed.push(...r.removed);
  keep(batchParts(body, solid, surface, { name: 'bodyBatch', skip: [flame] }));
  if (mats.decal) keep(mergeSiblings(body, mats.decal, 'numberDecals'));
  for (const wh of wheels) {
    const spinM = wh.spin.children[0];
    const fixed = wh.pivot.children.find((c) => c !== wh.spin);
    keep(batchParts(spinM, solid, surface, { name: 'wheelBatch' }));
    keep(batchParts(fixed, solid, surface, { name: 'caliperBatch', castShadow: false }));
  }
  keep(instanceRods(group, beams, mats.carbon, surface));
  // geometrias que nao sao mais usadas por nenhuma malha
  {
    const used = new Set();
    group.traverse((o) => o.geometry && used.add(o.geometry));
    for (const o of removed) if (o.geometry && !used.has(o.geometry)) o.geometry.dispose();
  }
  const rodMeshes = [...new Set(beams.map((b) => b.inst))];

  // ======================= ATUALIZACAO =======================
  const _o = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const orange = new THREE.Color(0xff7a1a);
  const blue = new THREE.Color(0x6fb2ff);
  let brakeLevel = 0;
  let time = 0;

  function placeRod(mesh, a, b) {
    _d.subVectors(b, a);
    const len = _d.length();
    mesh.position.addVectors(a, b).multiplyScalar(0.5);
    if (len > 1e-6) mesh.quaternion.setFromUnitVectors(UP, _d.multiplyScalar(1 / len));
    mesh.scale.set(1, Math.max(len, 1e-4), 1);
  }

  function update(state = {}) {
    const dt = Number.isFinite(state.dt) && state.dt > 0 ? Math.min(state.dt, 0.1) : 1 / 60;
    time += dt;
    const steer = state.steerAngle || 0;
    const spinArr = state.wheelSpin;
    const susp = state.suspension;

    for (let i = 0; i < wheels.length; i++) {
      const wh = wheels[i];
      wh.root.position.y = wh.base.y + ((susp && susp[i]) || 0);
      wh.pivot.rotation.y = wh.def.steer ? -steer : 0;
      wh.spin.rotation.x = ((spinArr && spinArr[i]) || 0) % TAU;
    }
    wheels.forEach((wh) => wh.root.updateMatrix());

    for (const bm of beams) {
      const wh = wheels[bm.wheel];
      _o.copy(bm.o);
      if (wh.def.steer) _o.applyAxisAngle(UP, wh.pivot.rotation.y);
      _b.addVectors(wh.root.position, _o);
      placeRod(bm.mesh, bm.a, _b);
      bm.mesh.updateMatrix();
      bm.inst.setMatrixAt(bm.index, bm.mesh.matrix);
    }
    for (const r of rodMeshes) r.instanceMatrix.needsUpdate = true;

    // luz de freio (suavizada)
    const k = 1 - Math.exp(-dt * 25);
    brakeLevel += ((state.braking ? 1 : 0) - brakeLevel) * k;
    mats.brake.emissiveIntensity = 0.15 + brakeLevel * 6;

    // turbo
    const boost = THREE.MathUtils.clamp(state.boost || 0, 0, 1);
    const flicker = 0.82 + 0.18 * Math.sin(time * 53.0) * Math.sin(time * 31.0 + 1.3);
    mats.exhaust.emissiveIntensity = boost * 2.5;
    mats.glow.emissive.lerpColors(orange, blue, boost);
    mats.glow.emissiveIntensity = 0.3 + boost * 6;
    flame.visible = boost > 0.01;
    if (!flame.visible) {
      // escala minima: Box3.setFromObject tambem conta objetos invisiveis
      flameOuter.scale.setScalar(1e-3);
      flameInner.scale.setScalar(1e-3);
    } else {
      const len = (0.2 + 0.8 * boost) * flicker;
      const r = 0.7 + 0.5 * boost;
      flameOuter.scale.set(r, r, len);
      flameInner.scale.set(r, r, len * 0.6);
      mats.flameOuter.opacity = Math.min(1, 0.25 + 0.65 * boost) * flicker;
      mats.flameInner.opacity = Math.min(1, 0.15 + 0.85 * boost) * flicker;
    }

    // disco de "motion blur" do aro em alta velocidade (evita efeito estroboscopico)
    const speed = Math.abs(state.speedKmh || 0);
    const blurOpacity = THREE.MathUtils.clamp((speed - 50) / 130, 0, 0.85);
    mats.blur.opacity = blurOpacity;
    mats.blur.visible = blurOpacity > 0.02;
  }

  function dispose() {
    const geos = new Set();
    const materials = new Set();
    group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isInstancedMesh) o.dispose();
      geos.add(o.geometry);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m));
    });
    geos.forEach((g) => g.dispose());
    materials.forEach((m) => {
      if (m.map) m.map.dispose();
      m.dispose();
    });
    if (group.parent) group.parent.remove(group);
  }

  // pecas pequenas nao projetam sombra: na camera de perseguicao nao aparecem
  // e cada uma custaria um draw call a mais no passe de sombra
  const NO_SHADOW = new Set(['suspension', 'hubNut', 'brakeDisc', 'caliper', 'rim', 'caliperBatch', 'suspensionRods']);
  const _sphere = new THREE.Sphere();
  group.traverse((o) => {
    if (!o.isMesh || !o.castShadow) return;
    if (NO_SHADOW.has(o.name)) {
      o.castShadow = false;
      return;
    }
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    _sphere.copy(o.geometry.boundingSphere);
    if (_sphere.radius * Math.max(Math.abs(o.scale.x), Math.abs(o.scale.y), Math.abs(o.scale.z)) < 0.12) o.castShadow = false;
  });

  update({});

  return { group, update, dispose, wheels };
}

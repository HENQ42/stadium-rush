// Cenario externo: ceu de fim de tarde, luzes, terreno, montanhas, lago,
// arvores/pedras instanciadas e decoracao da reta de largada (arquibancadas,
// placas, bandeiras, torres de iluminacao).
//
// Uso:
//   const env = createEnvironment(scene, renderer, track);
//   // a cada frame: env.update(carPosition, dt);
//   // ao sair: env.dispose();
//
// Pode ser importado no Node (sem DOM): texturas de canvas viram cores
// solidas e a geracao do mapa de ambiente (PMREM) e pulada.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Paleta / constantes
// ---------------------------------------------------------------------------
const SKY = {
  zenith: '#3b6db3',
  mid: '#8fb2d9',
  horizon: '#e9d2b4', // tambem e a cor da neblina
  glow: '#ffb066',
  sun: '#fff5dd',
  ground: '#55663a', // so no mapa de ambiente (abaixo do horizonte)
};
// Direcao (do chao para o sol): fim de tarde, ~16 graus de elevacao.
const SUN_DIRECTION = new THREE.Vector3(-0.6, 0.27, -0.75).normalize();
const WIND = new THREE.Vector3(0.8, 0, 0.6).normalize();

const TERRAIN_HALF = 4000; // terreno de 8 km x 8 km
const TERRAIN_FINE = 1100; // regiao com malha fina (25 m)
const TERRAIN_STEP = 25;
const FLAT_RADIUS = 250; // terreno 100% plano ate esta distancia da linha central (>= 200 m garantido)
const HILL_FULL = 700;
const SUN_DISTANCE = 220;

const hasDOM = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

// ---------------------------------------------------------------------------
// Aleatorio / ruido deterministico
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2i(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function hash3i(a, b, c, seed) {
  return hash2i(a ^ Math.imul(c | 0, 0x27d4eb2d), b, seed);
}

const mod = (a, n) => ((a % n) + n) % n;
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function valueNoise(x, z, seed, period = 0) {
  const fx0 = Math.floor(x);
  const fz0 = Math.floor(z);
  const fx = x - fx0;
  const fz = z - fz0;
  let ix = fx0, iz = fz0, ix1 = fx0 + 1, iz1 = fz0 + 1;
  if (period) {
    ix = mod(ix, period); ix1 = mod(ix1, period);
    iz = mod(iz, period); iz1 = mod(iz1, period);
  }
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2i(ix, iz, seed);
  const b = hash2i(ix1, iz, seed);
  const c = hash2i(ix, iz1, seed);
  const d = hash2i(ix1, iz1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

function fbm(x, z, octaves, seed) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, z, seed + o * 17);
    norm += amp;
    // rotacao leve entre oitavas para esconder a grade
    const nx = x * 1.6 + z * 1.2;
    z = -x * 1.2 + z * 1.6;
    x = nx;
    amp *= 0.5;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Geometria: lote de primitivas mescladas (1 draw call por lote)
// ---------------------------------------------------------------------------
class Batch {
  constructor({ uv = false, color = true } = {}) {
    this.parts = [];
    this.uv = uv;
    this.color = color;
  }

  // color: THREE.Color ou fn(outColor, faceCenterY, faceIndex)
  add(geo, color, matrix, vary = 0, rng = Math.random) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (!this.uv) g.deleteAttribute('uv');
    if (matrix) g.applyMatrix4(matrix);
    if (this.color) {
      const pos = g.attributes.position;
      const n = pos.count;
      const col = new Float32Array(n * 3);
      const c = new THREE.Color();
      for (let f = 0; f + 2 < n; f += 3) {
        if (typeof color === 'function') color(c, (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3, f / 3);
        else c.copy(color);
        const k = vary ? 1 + (rng() * 2 - 1) * vary : 1;
        for (let v = 0; v < 3; v++) {
          col[(f + v) * 3] = c.r * k;
          col[(f + v) * 3 + 1] = c.g * k;
          col[(f + v) * 3 + 2] = c.b * k;
        }
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    this.parts.push(g);
    return this;
  }

  build() {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    return merged;
  }
}

// desloca vertices de forma consistente (vertices duplicados recebem o mesmo deslocamento)
function jitter(geo, amount, seed, ampY = amount) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const kx = Math.round(x * 997), ky = Math.round(y * 991), kz = Math.round(z * 983);
    p.setXYZ(
      i,
      x + (hash3i(kx, ky, kz, seed) - 0.5) * 2 * amount,
      y + (hash3i(kx, ky, kz, seed + 1) - 0.5) * 2 * ampY,
      z + (hash3i(kx, ky, kz, seed + 2) - 0.5) * 2 * amount,
    );
  }
  return geo;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
function mat(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
}

const C = (hex) => new THREE.Color(hex);

function srgbVec(hex) {
  const o = { r: 0, g: 0, b: 0 };
  new THREE.Color(hex).getRGB(o, THREE.SRGBColorSpace);
  return new THREE.Vector3(o.r, o.g, o.b);
}

// ---------------------------------------------------------------------------
// Ceu (gradiente + disco solar + nuvens procedurais)
// A saida e em espaco de exibicao (sRGB, sem tone mapping) para que o
// horizonte seja exatamente a cor de scene.fog.
// ---------------------------------------------------------------------------
const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position * 10.0, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uGlow;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uEnvMode;
uniform float uCloudCover;
varying vec3 vDir;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
    a *= 0.5;
  }
  return s / 0.96875;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float hp = max(h, 0.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.18, hp));
  col = mix(col, uZenith, smoothstep(0.10, 0.75, hp));

  float mu = dot(d, uSunDir);
  float sm = max(mu, 0.0);
  float above = smoothstep(0.0, 0.12, h);
  col += uGlow * (0.22 * pow(sm, 5.0) + 0.5 * pow(sm, 40.0)) * above;
  float disc = smoothstep(0.99960, 0.99985, mu);
  col = mix(col, uSunColor, disc);

  if (h > 0.0 && uCloudCover > 0.0) {
    vec2 uv = d.xz / (h + 0.10) * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
    float n = fbm(uv);
    float m = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.22, n);
    m *= smoothstep(0.02, 0.20, h) * (1.0 - 0.9 * smoothstep(0.985, 0.9985, mu));
    float lit = 0.5 + 0.5 * pow(sm, 3.0);
    vec3 cc = mix(vec3(0.66, 0.66, 0.76), vec3(1.0, 0.93, 0.82), lit);
    cc += uGlow * pow(sm, 18.0) * 0.35 * (1.0 - m);
    col = mix(col, cc, m * 0.85);
  }

  col = mix(col, uGround, uEnvMode * (1.0 - smoothstep(-0.10, 0.0, h)));
  if (uEnvMode > 0.5) {
    // mapa de ambiente: converte para linear e deixa o sol em HDR
    col = pow(max(col, vec3(0.0)), vec3(2.2)) + pow(uSunColor, vec3(2.2)) * disc * 24.0;
  } else {
    col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0; // dithering contra banding
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function makeSkyMaterial(envMode, cloudCover) {
  return new THREE.ShaderMaterial({
    name: envMode ? 'EnvSkyCapture' : 'EnvSky',
    uniforms: {
      uZenith: { value: srgbVec(SKY.zenith) },
      uMid: { value: srgbVec(SKY.mid) },
      uHorizon: { value: srgbVec(SKY.horizon) },
      uGround: { value: srgbVec(SKY.ground) },
      uGlow: { value: srgbVec(SKY.glow) },
      uSunColor: { value: srgbVec(SKY.sun) },
      uSunDir: { value: SUN_DIRECTION.clone() },
      uTime: { value: 0 },
      uEnvMode: { value: envMode ? 1 : 0 },
      uCloudCover: { value: cloudCover },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
}

// ---------------------------------------------------------------------------
// Texturas de canvas
// ---------------------------------------------------------------------------
function makeGrassTexture(renderer, seed) {
  if (!hasDOM()) return null;
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(S, S);
  const rng = mulberry32(seed);
  const dark = [62, 104, 38];
  const light = [128, 168, 74];
  const dry = [160, 158, 86];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // ruido periodico (textura repetivel sem costura)
      const n1 = valueNoise(x / 64, y / 64, seed + 1, 8);
      const n2 = valueNoise(x / 16, y / 16, seed + 2, 32);
      const n3 = valueNoise(x / 4, y / 4, seed + 3, 128);
      const g = rng();
      let v = 0.42 * n1 + 0.3 * n2 + 0.18 * n3 + 0.1 * g;
      v = Math.min(1, Math.max(0, (v - 0.5) * 1.5 + 0.5));
      let r = lerp(dark[0], light[0], v);
      let gg = lerp(dark[1], light[1], v);
      let b = lerp(dark[2], light[2], v);
      const dryAmt = smoothstep(0.62, 0.8, n1 * 0.6 + n3 * 0.4) * 0.45;
      r = lerp(r, dry[0], dryAmt);
      gg = lerp(gg, dry[1], dryAmt);
      b = lerp(b, dry[2], dryAmt);
      if (g > 0.985) { r *= 1.25; gg *= 1.2; b *= 1.1; } // pontinhos claros
      else if (g < 0.02) { r *= 0.7; gg *= 0.75; b *= 0.7; }
      const i = (y * S + x) * 4;
      img.data[i] = Math.min(255, r);
      img.data[i + 1] = Math.min(255, gg);
      img.data[i + 2] = Math.min(255, b);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy(renderer);
  return tex;
}

const ADS = [
  { bg: '#d62828', fg: '#ffffff', t: 'VELOX' },
  { bg: '#1d3557', fg: '#ffd60a', t: 'NITRO' },
  { bg: '#ffd60a', fg: '#111111', t: 'TURBO GP' },
  { bg: '#ffffff', fg: '#e63946', t: 'APEX' },
  { bg: '#2a9d8f', fg: '#ffffff', t: 'GRIP+' },
  { bg: '#111111', fg: '#f77f00', t: 'BOOST' },
  { bg: '#f77f00', fg: '#ffffff', t: 'RALLYE' },
  { bg: '#3a0ca3', fg: '#ffffff', t: 'STADIUM' },
  { bg: '#e9ecef', fg: '#1d3557', t: 'SPEEDWAY' },
  { bg: '#06d6a0', fg: '#073b4c', t: 'VOLT' },
];
const AD_COLS = 2;
const AD_ROWS = 5;

function makeAdsTexture(renderer) {
  if (!hasDOM()) return null;
  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const pw = W / AD_COLS, ph = H / AD_ROWS;
  ADS.forEach((ad, i) => {
    const x0 = (i % AD_COLS) * pw;
    const y0 = Math.floor(i / AD_COLS) * ph;
    ctx.fillStyle = ad.bg;
    ctx.fillRect(x0, y0, pw, ph);
    ctx.fillStyle = ad.fg;
    ctx.globalAlpha = 0.18;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      const sx = x0 + pw * 0.72 + k * 26;
      ctx.moveTo(sx, y0 + ph);
      ctx.lineTo(sx + 14, y0 + ph);
      ctx.lineTo(sx + 44, y0);
      ctx.lineTo(sx + 30, y0);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillRect(x0, y0 + ph - 8, pw, 4);
    ctx.font = 'italic bold 62px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ad.t, x0 + pw * 0.46, y0 + ph * 0.5, pw * 0.8);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy(renderer);
  return tex;
}

function maxAnisotropy(renderer) {
  const caps = renderer && renderer.capabilities;
  if (caps && typeof caps.getMaxAnisotropy === 'function') return Math.min(8, caps.getMaxAnisotropy());
  return 1;
}

// plano de anuncio com UV apontando para o painel `index` do atlas
function adPlane(width, height, index) {
  const g = new THREE.PlaneGeometry(width, height);
  const i = mod(index, ADS.length);
  const col = i % AD_COLS;
  const row = Math.floor(i / AD_COLS);
  const uv = g.attributes.uv;
  const eps = 0.004;
  for (let k = 0; k < uv.count; k++) {
    const u = uv.getX(k), v = uv.getY(k);
    uv.setXY(
      k,
      (col + eps + u * (1 - 2 * eps)) / AD_COLS,
      (AD_ROWS - 1 - row + eps + v * (1 - 2 * eps)) / AD_ROWS,
    );
  }
  return g;
}

// ---------------------------------------------------------------------------
// Consultas auxiliares sobre a pista
// ---------------------------------------------------------------------------
function makeTrackHelpers(track) {
  const n = track.count;
  const px = track.px, pz = track.pz;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]);
    minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const outer = track.halfWidth + ((track.config && track.config.wallThickness) || 0.6);

  // distancia horizontal ate a linha central (sem limite de alcance)
  function centerDist(x, z) {
    let best = Infinity;
    for (let i = 0; i < n; i += 2) {
      const dx = px[i] - x, dz = pz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function insideLoop(x, z) {
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const zi = pz[i], zj = pz[j];
      if ((zi > z) !== (zj > z) && x < ((px[j] - px[i]) * (z - zi)) / (zj - zi) + px[i]) inside = !inside;
    }
    return inside;
  }

  // area reservada para a decoracao da reta de largada
  const tmp = {};
  function inDressingZone(x, z) {
    const p = track.project(x, z, tmp);
    if (!p) return false;
    return Math.abs(p.u) < 52 && (p.s < 330 || p.s > track.length - 20);
  }

  return { cx, cz, outer, centerDist, insideLoop, inDressingZone, radius: Math.hypot(maxX - minX, maxZ - minZ) / 2 };
}

// ---------------------------------------------------------------------------
// Terreno
// ---------------------------------------------------------------------------
function axisCoords(center) {
  const offs = [0];
  let o = 0, st = TERRAIN_STEP;
  while (o < TERRAIN_HALF) {
    if (o >= TERRAIN_FINE) st *= 1.18;
    o = Math.min(TERRAIN_HALF, o + st);
    offs.push(o);
  }
  const out = [];
  for (let i = offs.length - 1; i > 0; i--) out.push(center - offs[i]);
  for (let i = 0; i < offs.length; i++) out.push(center + offs[i]);
  return out;
}

function buildTerrain(helpers, seed, grassTex) {
  const { cx, cz, centerDist } = helpers;
  const xs = axisCoords(cx);
  const zs = axisCoords(cz);
  const nx = xs.length, nz = zs.length;
  const heights = new Float32Array(nx * nz);
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const lush = [0.86, 1.0, 0.82];
  const dryC = [1.12, 1.04, 0.78];
  const hillC = [0.95, 0.98, 0.86];

  const heightFn = (x, z) => {
    const near = Math.abs(x - cx) < 1300 && Math.abs(z - cz) < 1300;
    const d = near ? centerDist(x, z) : 1e9;
    const ramp = smoothstep(FLAT_RADIUS, HILL_FULL, d);
    if (ramp <= 0) return 0;
    const n = fbm(x * 0.0022, z * 0.0022, 4, seed + 11);
    const hills = 6 + 42 * smoothstep(0.35, 0.8, n);
    const r = Math.hypot(x - cx, z - cz);
    const rim = 140 * smoothstep(1800, 3800, r);
    return ramp * (hills + rim);
  };

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = xs[i], z = zs[j];
      const h = heightFn(x, z);
      heights[k] = h;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      uv[k * 2] = x / 8;
      uv[k * 2 + 1] = z / 8;
      const n1 = fbm(x / 160, z / 160, 3, seed + 21);
      const n2 = valueNoise(x / 45, z / 45, seed + 22);
      const t = smoothstep(0.3, 0.75, n1);
      const hill = smoothstep(2, 30, h) * 0.6;
      const b = 0.92 + 0.16 * n2;
      for (let c = 0; c < 3; c++) col[k * 3 + c] = lerp(lerp(lush[c], dryC[c], t), hillC[c], hill) * b;
    }
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let w = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      index[w++] = a; index[w++] = c; index[w++] = b;
      index[w++] = b; index[w++] = c; index[w++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshLambertMaterial({
    color: grassTex ? 0xffffff : 0x6f9a45,
    map: grassTex,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  if (grassTex) {
    // mistura duas escalas da mesma textura para esconder a repeticao
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 grassA = texture2D( map, vMapUv );
          vec4 grassB = texture2D( map, vMapUv * 0.137 + vec2( 0.31, 0.71 ) );
          diffuseColor.rgb *= mix( grassA.rgb, grassB.rgb, 0.45 );
        #endif`,
      );
    };
    mat.customProgramCacheKey = () => 'env-terrain-grass';
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'env-terrain';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;

  // altura exata da malha (mesma triangulacao)
  function findCell(arr, v) {
    let lo = 0, hi = arr.length - 2;
    if (v <= arr[0]) return 0;
    if (v >= arr[hi + 1]) return hi;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid] <= v) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  function heightAt(x, z) {
    const i = findCell(xs, x);
    const j = findCell(zs, z);
    const fx = Math.min(1, Math.max(0, (x - xs[i]) / (xs[i + 1] - xs[i])));
    const fz = Math.min(1, Math.max(0, (z - zs[j]) / (zs[j + 1] - zs[j])));
    const ha = heights[j * nx + i], hb = heights[j * nx + i + 1];
    const hc = heights[(j + 1) * nx + i], hd = heights[(j + 1) * nx + i + 1];
    if (fx + fz <= 1) return ha + (hb - ha) * fx + (hc - ha) * fz;
    return hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
  }

  return { mesh, heightAt };
}

// ---------------------------------------------------------------------------
// Montanhas distantes
// ---------------------------------------------------------------------------
function buildMountains(helpers, rng, material) {
  const { cx, cz } = helpers;
  const batch = new Batch();
  const low = C('#4b6657'), mid = C('#5e7391'), high = C('#7c8ca8'), snow = C('#eef2f8');
  const rings = [
    { n: 26, r0: 1000, r1: 1250, h0: 90, h1: 230, b0: 180, b1: 300, off: 0 },
    { n: 22, r0: 1320, r1: 1600, h0: 200, h1: 430, b0: 280, b1: 470, off: 0.5 },
  ];
  let id = 0;
  for (const ring of rings) {
    for (let k = 0; k < ring.n; k++) {
      const ang = ((k + ring.off + rng() * 0.6) / ring.n) * Math.PI * 2;
      const R = lerp(ring.r0, ring.r1, rng());
      const h = lerp(ring.h0, ring.h1, rng() * rng() * 0.6 + rng() * 0.4);
      const rad = lerp(ring.b0, ring.b1, rng());
      const seg = 7 + Math.floor(rng() * 4);
      const g = new THREE.ConeGeometry(rad, h, seg, 5, true);
      // irregularidade: aneis deslocados, pico fora do centro
      const p = g.attributes.position;
      const shiftX = (rng() - 0.5) * rad * 0.5;
      const shiftZ = (rng() - 0.5) * rad * 0.5;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const kx = Math.round(x * 31), ky = Math.round(y * 29), kz = Math.round(z * 37);
        const t = (y + h / 2) / h; // 0 base, 1 pico
        const rj = 1 + (hash3i(kx, ky, kz, id) - 0.5) * 0.45 * (1 - t * 0.5);
        const yj = (hash3i(kx, ky, kz, id + 1) - 0.5) * h * 0.1 * (t > 0.02 ? 1 : 0);
        p.setXYZ(i, x * rj + shiftX * t, y + yj, z * rj + shiftZ * t);
      }
      const base = -12;
      const snowy = h > 260;
      const m = mat(
        cx + Math.cos(ang) * R, base + h / 2, cz + Math.sin(ang) * R,
        rng() * Math.PI * 2, 1 + rng() * 0.7, 1, 1,
      );
      batch.add(g, (c, y) => {
        const t = Math.min(1, Math.max(0, (y - base) / h));
        if (snowy && t > 0.7 + hash2i(id, Math.round(y), 5) * 0.12) c.copy(snow);
        else if (t < 0.45) c.copy(low).lerp(mid, t / 0.45);
        else c.copy(mid).lerp(high, (t - 0.45) / 0.55);
      }, m, 0.06, rng);
      id += 3;
    }
  }
  const mesh = new THREE.Mesh(batch.build(), material);
  mesh.name = 'env-mountains';
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// Lago
// ---------------------------------------------------------------------------
function buildLake(track, helpers, rng) {
  const minClear = helpers.outer + 30; // > 30 m da face externa do muro
  const candidates = [
    [130, 60, 55], [125, 110, 50], [-170, -40, 60], [-160, 160, 60], [400, -60, 60], [130, 60, 40],
  ];
  const a1 = rng() * 6.28, a2 = rng() * 6.28;
  const radiusAt = (R, th) => R * (1 + 0.18 * Math.sin(3 * th + a1) + 0.1 * Math.sin(5 * th + a2));
  const SHORE = 5;
  for (const [lx, lz, R] of candidates) {
    let ok = true;
    let maxR = 0;
    for (let k = 0; k < 64 && ok; k++) {
      const th = (k / 64) * Math.PI * 2;
      const r = radiusAt(R, th) * 1.04 + SHORE;
      maxR = Math.max(maxR, r);
      const x = lx + Math.cos(th) * r, z = lz + Math.sin(th) * r;
      if (helpers.centerDist(x, z) - helpers.outer < 30 || !(track.distanceFromRoad(x, z) > 30)) ok = false;
    }
    if (!ok || helpers.centerDist(lx, lz) < minClear + R) continue;

    const N = 72;
    const water = new THREE.Shape();
    const shoreShape = new THREE.Shape();
    const hole = new THREE.Path();
    for (let k = 0; k < N; k++) {
      const th = (k / N) * Math.PI * 2;
      const r = radiusAt(R, th);
      const ro = r * 1.04 + SHORE * (0.7 + 0.6 * valueNoise(k * 0.4, 3, 77));
      // shape no plano XY; rotateX(-90) leva (x, y) -> (x, 0, -y)
      const wx = Math.cos(th) * r, wy = -Math.sin(th) * r;
      const sx = Math.cos(th) * ro, sy = -Math.sin(th) * ro;
      const hx = Math.cos(th) * r * 0.97, hy = -Math.sin(th) * r * 0.97;
      if (k === 0) { water.moveTo(wx, wy); shoreShape.moveTo(sx, sy); hole.moveTo(hx, hy); }
      else { water.lineTo(wx, wy); shoreShape.lineTo(sx, sy); hole.lineTo(hx, hy); }
    }
    shoreShape.holes.push(hole);
    const wGeo = new THREE.ShapeGeometry(water, 1);
    wGeo.rotateX(-Math.PI / 2);
    wGeo.translate(lx, 0.06, lz);
    wGeo.deleteAttribute('uv');
    const sGeo = new THREE.ShapeGeometry(shoreShape, 1);
    sGeo.rotateX(-Math.PI / 2);
    sGeo.translate(lx, 0.035, lz);
    sGeo.deleteAttribute('uv');

    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x2f6378, roughness: 0.06, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const shoreMat = new THREE.MeshLambertMaterial({
      color: 0xb9a77e, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const waterMesh = new THREE.Mesh(wGeo, waterMat);
    waterMesh.name = 'env-lake';
    waterMesh.receiveShadow = true;
    const shoreMesh = new THREE.Mesh(sGeo, shoreMat);
    shoreMesh.name = 'env-lake-shore';
    shoreMesh.receiveShadow = true;
    return { meshes: [shoreMesh, waterMesh], x: lx, z: lz, maxR };
  }
  return { meshes: [], x: 0, z: 0, maxR: -1 };
}

// ---------------------------------------------------------------------------
// Vegetacao / pedras
// ---------------------------------------------------------------------------
function pineGeometry(rng) {
  const b = new Batch();
  b.add(new THREE.CylinderGeometry(0.22, 0.32, 2.6, 6, 1, true), C('#5b3f2a'), mat(0, 1.3, 0), 0.05, rng);
  const layers = [[2.5, 3.4, 2.9], [2.0, 3.1, 4.7], [1.45, 2.8, 6.4], [0.85, 2.2, 7.9]];
  const base = C('#2c5733'), top = C('#3f7541');
  layers.forEach(([r, h, y], i) => {
    const g = jitter(new THREE.ConeGeometry(r, h, 7, 1, false), 0.12, 100 + i, 0.05);
    b.add(g, base.clone().lerp(top, i / 3), mat(0, y, 0, i * 0.7), 0.08, rng);
  });
  return b.build();
}

// detail 0 = versao simplificada (arvores distantes nos graficos medio/baixo)
function roundTreeGeometry(rng, detail = 1) {
  const b = new Batch();
  b.add(new THREE.CylinderGeometry(0.2, 0.3, 3.2, 6, 1, true), C('#6b4a32'), mat(0, 1.6, 0), 0.05, rng);
  b.add(jitter(new THREE.IcosahedronGeometry(2.4, detail), 0.32, 201), C('#4f8a3a'), mat(0, 4.6, 0, 0, 1, 0.88, 1), 0.1, rng);
  b.add(jitter(new THREE.IcosahedronGeometry(1.6, 0), 0.2, 202), C('#5c9a40'), mat(1.1, 5.6, 0.5), 0.1, rng);
  b.add(jitter(new THREE.IcosahedronGeometry(1.4, 0), 0.2, 203), C('#467f35'), mat(-1.0, 4.2, -0.7), 0.1, rng);
  return b.build();
}

function poplarGeometry(rng, detail = 1) {
  const b = new Batch();
  b.add(new THREE.CylinderGeometry(0.16, 0.24, 2.4, 5, 1, true), C('#8a7a66'), mat(0, 1.2, 0), 0.05, rng);
  b.add(jitter(new THREE.IcosahedronGeometry(1.5, detail), 0.18, 301), C('#6b9a3e'), mat(0, 5.4, 0, 0, 1, 2.3, 1), 0.1, rng);
  return b.build();
}

function bushGeometry(rng, detail = 1) {
  const b = new Batch();
  b.add(jitter(new THREE.IcosahedronGeometry(1, detail), 0.16, 401), C('#3e6e32'), mat(0, 0.45, 0, 0, 1.3, 0.75, 1.1), 0.12, rng);
  return b.build();
}

function rockGeometry(rng) {
  const b = new Batch();
  b.add(jitter(new THREE.DodecahedronGeometry(1, 0), 0.22, 501), C('#8b8780'), mat(0, 0.2, 0, 0, 1.2, 0.7, 1.0), 0.12, rng);
  return b.build();
}

function makeInstanced(geometry, material, items, name, { castShadow = false, receiveShadow = false } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
  mesh.name = name;
  mesh.count = items.length;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.rot);
    if (it.quat) q.premultiply(it.quat);
    m.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx ?? it.s, it.sy ?? it.s, it.sz ?? it.s));
    mesh.setMatrixAt(i, m);
    c.setRGB(it.r ?? 1, it.g ?? 1, it.b ?? 1);
    mesh.setColorAt(i, c);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.matrixAutoUpdate = false;
  mesh.computeBoundingSphere();
  return mesh;
}

function scatterVegetation(track, helpers, terrain, lake, rng, density) {
  const { cx, cz, centerDist, insideLoop, inDressingZone } = helpers;
  const NEAR_SHADOW = 160; // arvores mais perto que isto projetam sombra
  const trees = { pine: { near: [], far: [] }, round: { near: [], far: [] }, poplar: { near: [], far: [] } };
  const bushes = [];
  const rocks = [];
  const clusters = [];

  const accept = (x, z, minRoad = 14) => {
    const d = track.distanceFromRoad(x, z);
    if (!(d > minRoad)) return false;
    if (inDressingZone(x, z)) return false;
    if (lake.maxR > 0 && Math.hypot(x - lake.x, z - lake.z) < lake.maxR + 4) return false;
    return true;
  };
  const gauss = () => (rng() + rng() + rng() - 1.5) * 0.8;
  const pickVariant = (type) => {
    const r = rng();
    if (type === 0) return r < 0.8 ? 'pine' : r < 0.9 ? 'round' : 'poplar';
    if (type === 1) return r < 0.65 ? 'round' : r < 0.85 ? 'poplar' : 'pine';
    return r < 0.4 ? 'pine' : r < 0.8 ? 'round' : 'poplar';
  };
  const addTree = (x, z, variant, scaleMul = 1) => {
    const dTrack = centerDist(x, z);
    const s = (0.75 + rng() * 0.7) * scaleMul;
    const tint = 0.85 + rng() * 0.25;
    const item = {
      x, z, y: terrain.heightAt(x, z) - 0.15, rot: rng() * Math.PI * 2,
      s, sy: s * (0.85 + rng() * 0.3),
      r: tint * (0.95 + rng() * 0.1), g: tint, b: tint * (0.9 + rng() * 0.1),
    };
    trees[variant][dTrack < NEAR_SHADOW ? 'near' : 'far'].push(item);
  };

  // aglomerados perto da pista
  const nearClusters = Math.round(165 * density);
  let guard = 0;
  while (clusters.length < nearClusters && guard++ < nearClusters * 20) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 700;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const d = centerDist(x, z);
    if (d < 25 || d > 330) continue;
    if (insideLoop(x, z) && rng() < 0.55) continue; // infield menos denso
    clusters.push({ x, z, r: 10 + rng() * 40, n: Math.round(6 + rng() * 22), type: Math.floor(rng() * 3) });
  }
  // alguns aglomerados na margem do lago
  if (lake.maxR > 0) {
    for (let k = 0; k < 5; k++) {
      const a = rng() * Math.PI * 2;
      clusters.push({
        x: lake.x + Math.cos(a) * (lake.maxR + 14), z: lake.z + Math.sin(a) * (lake.maxR + 14),
        r: 12 + rng() * 10, n: 12, type: 1,
      });
    }
  }
  for (const cl of clusters) {
    for (let t = 0; t < cl.n; t++) {
      const x = cl.x + gauss() * cl.r, z = cl.z + gauss() * cl.r;
      if (accept(x, z)) addTree(x, z, pickVariant(cl.type));
    }
  }
  // arvores isoladas
  for (let k = 0; k < Math.round(380 * density); k++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 650;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const d = centerDist(x, z);
    if (d > 380) continue;
    if (insideLoop(x, z) && rng() < 0.5) continue;
    if (accept(x, z)) addTree(x, z, pickVariant(2));
  }
  // florestas nas colinas distantes (sem sombra)
  for (let k = 0; k < Math.round(70 * density); k++) {
    const a = rng() * Math.PI * 2;
    const r = 560 + rng() * 420;
    const ccx = cx + Math.cos(a) * r, ccz = cz + Math.sin(a) * r;
    const rad = 30 + rng() * 60;
    const n = Math.round(12 + rng() * 22);
    const type = rng() < 0.6 ? 0 : 2;
    for (let t = 0; t < n; t++) {
      const x = ccx + gauss() * rad, z = ccz + gauss() * rad;
      if (accept(x, z)) addTree(x, z, pickVariant(type), 1.15);
    }
  }
  // arbustos: bordas dos aglomerados + espalhados
  for (let k = 0; k < Math.round(800 * density); k++) {
    let x, z;
    if (k % 2 === 0 && clusters.length) {
      const cl = clusters[Math.floor(rng() * clusters.length)];
      const a = rng() * Math.PI * 2;
      const r = cl.r * (0.8 + rng() * 0.6);
      x = cl.x + Math.cos(a) * r; z = cl.z + Math.sin(a) * r;
    } else {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 600;
      x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r;
      if (centerDist(x, z) > 300) continue;
    }
    if (!accept(x, z)) continue;
    const s = 0.6 + rng() * 0.9;
    const tint = 0.8 + rng() * 0.35;
    bushes.push({ x, z, y: terrain.heightAt(x, z) - 0.1, rot: rng() * 6.28, s, sy: s * (0.8 + rng() * 0.4), r: tint, g: tint, b: tint * 0.95 });
  }
  // pedras
  const upAxis = new THREE.Vector3();
  for (let k = 0; k < Math.round(340 * density); k++) {
    let x, z;
    if (k < 40 && lake.maxR > 0) {
      const a = rng() * Math.PI * 2;
      const r = lake.maxR + 4.5 + rng() * 8;
      x = lake.x + Math.cos(a) * r; z = lake.z + Math.sin(a) * r;
    } else {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 900;
      x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r;
    }
    if (!accept(x, z)) continue;
    const s = 0.4 + rng() * rng() * 2.2;
    const tint = 0.8 + rng() * 0.35;
    upAxis.set(rng() - 0.5, 2, rng() - 0.5).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), upAxis);
    rocks.push({ x, z, y: terrain.heightAt(x, z) - 0.25 * s, rot: rng() * 6.28, quat, s, sx: s * (0.8 + rng() * 0.5), r: tint, g: tint, b: tint });
  }
  return { trees, bushes, rocks };
}

// ---------------------------------------------------------------------------
// Decoracao da reta de largada
// ---------------------------------------------------------------------------
const CROWD_COLORS = ['#e63946', '#f1fa3c', '#2a9df4', '#ffffff', '#ff8c1a', '#2ec4b6', '#9b5de5',
  '#f15bb5', '#1d3557', '#ffd60a', '#43aa8b', '#222222', '#c0c0c0', '#ff006e'];
const FLAG_COLORS = ['#e63946', '#ffd60a', '#2a9df4', '#ffffff', '#2ec4b6', '#f77f00', '#9b5de5'];

function frameMatrix(f) {
  return new THREE.Matrix4().makeRotationY(f.heading).setPosition(f.x, 0, f.z);
}

function buildDressing(track, rng) {
  const hw = track.halfWidth;
  const structures = new Batch();
  const lamps = new Batch({ color: false });
  const ads = new Batch({ uv: true, color: false });
  const crowd = [];
  const flags = [];
  let adIndex = 0;

  const concrete = C('#bdb6aa'), concreteDark = C('#8a857c'), steel = C('#5a6068');
  const roofWhite = C('#eeeeea'), poleColor = C('#d8d8d8'), boardFrame = C('#2b2f36');
  const crowdCols = CROWD_COLORS.map(C);
  const flagCols = FLAG_COLORS.map(C);
  const windRot = Math.atan2(-WIND.z, WIND.x);

  const local = (F, lx, ly, lz, ry = 0, rz = 0) => F.clone().multiply(mat(lx, ly, lz, ry, 1, 1, 1, 0, rz));

  // ---- arquibancadas ----
  const STAND_S = 55, STAND_L = 80;
  const FRONT = hw + 9, RD = 1.3, RISE = 0.6, BASE = 1.0, ROWS = 9;
  const BACK = FRONT + ROWS * RD;
  const stands = [
    { sigma: 1, seat: C('#2c5fd6'), trim: C('#1f4fbf') },
    { sigma: -1, seat: C('#d63a2c'), trim: C('#c62f2f') },
  ];
  for (const st of stands) {
    const sg = st.sigma;
    const F = frameMatrix(track.frameAt(STAND_S, 0));
    const box = (w, h, d, color, lx, ly, lz, rz = 0, vary = 0.03) =>
      structures.add(new THREE.BoxGeometry(w, h, d), color, local(F, lx, ly, lz, 0, rz), vary, rng);

    for (let i = 0; i < ROWS; i++) {
      const yTop = BASE + i * RISE;
      box(RD, yTop, STAND_L, i % 2 ? concrete : concreteDark.clone().lerp(concrete, 0.6), sg * (FRONT + (i + 0.5) * RD), yTop / 2, 0);
      box(0.5, 0.42, STAND_L - 0.4, st.seat, sg * (FRONT + i * RD + 1.0), yTop + 0.21, 0, 0, 0.02);
      // torcida
      for (let z = -STAND_L / 2 + 0.5; z < STAND_L / 2 - 0.4; z += 0.62) {
        if (rng() > 0.78) continue;
        const p = new THREE.Vector3(sg * (FRONT + i * RD + 0.5 + (rng() - 0.5) * 0.15), yTop, z + (rng() - 0.5) * 0.15).applyMatrix4(F);
        const c = crowdCols[Math.floor(rng() * crowdCols.length)];
        const h = 0.75 + rng() * 0.25;
        crowd.push({ x: p.x, y: p.y, z: p.z, rot: track.frameAt(STAND_S, 0).heading + (rng() - 0.5) * 0.4, s: 1, sx: 1, sy: h, sz: 1, r: c.r, g: c.g, b: c.b });
      }
    }
    // parapeito com anuncios
    box(0.3, 1.5, STAND_L, concrete, sg * (FRONT - 0.15), 0.75, 0);
    const nAds = Math.floor(STAND_L / 6);
    for (let k = 0; k < nAds; k++) {
      const z = -STAND_L / 2 + (k + 0.5) * (STAND_L / nAds);
      ads.add(adPlane(STAND_L / nAds - 0.1, 1.1, adIndex++), null, local(F, sg * (FRONT - 0.31), 0.8, z, -sg * Math.PI / 2));
    }
    // parede de fundo, laterais, cobertura
    box(0.4, 12.4, STAND_L + 0.4, concreteDark, sg * (BACK + 0.2), 6.2, 0);
    const sideH = BASE + ROWS * RISE + 0.6;
    for (const e of [-1, 1]) box(BACK - FRONT + 0.7, sideH, 0.4, concreteDark, sg * ((FRONT + BACK) / 2 + 0.05), sideH / 2, e * (STAND_L / 2 + 0.2));
    const roofFront = FRONT - 1.6, roofBack = BACK + 1.3;
    const roofD = roofBack - roofFront;
    const tilt = sg * 0.08;
    box(roofD, 0.35, STAND_L + 2, roofWhite, sg * (roofFront + roofBack) / 2, 11.9, 0, tilt, 0.01);
    box(0.4, 0.9, STAND_L + 2, st.trim, sg * roofFront, 11.9 - (roofD / 2) * Math.sin(0.08) - 0.2, 0, 0, 0.01);
    for (let k = 0; k <= 4; k++) box(0.3, 11.2, 0.3, steel, sg * (FRONT - 1.2), 5.6, -STAND_L / 2 + 1 + k * ((STAND_L - 2) / 4));
    for (let k = 0; k <= 8; k++) box(0.5, 12.6, 0.5, steel, sg * (BACK + 0.65), 6.3, -STAND_L / 2 + k * (STAND_L / 8));
    // mastros com bandeiras no topo
    for (let k = 0; k < 7; k++) {
      const z = -STAND_L / 2 + 5 + k * ((STAND_L - 10) / 6);
      structures.add(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 5), poleColor, local(F, sg * (BACK + 1.0), 12.5 + 2.3, z), 0, rng);
      const p = new THREE.Vector3(sg * (BACK + 1.0), 16.7, z).applyMatrix4(F);
      const c = flagCols[(k + (sg > 0 ? 0 : 3)) % flagCols.length];
      flags.push({ x: p.x, y: p.y, z: p.z, rot: windRot, s: 1, sx: 2.2, sy: 1.3, sz: 1, r: c.r, g: c.g, b: c.b });
    }
  }

  // ---- placas de publicidade ao longo da reta ----
  const BOARD_U = hw + 3.85; // face interna em hw + 3.77 (> hw + 3)
  for (const sg of [1, -1]) {
    for (let s = 3; s + 6 <= 306; s += 6.3) {
      const F = frameMatrix(track.frameAt(s + 3, sg * BOARD_U));
      structures.add(new THREE.BoxGeometry(0.16, 1.3, 6.0), boardFrame, local(F, 0, 0.95, 0), 0.02, rng);
      for (const e of [-1, 1]) structures.add(new THREE.BoxGeometry(0.12, 0.3, 0.12), boardFrame, local(F, 0, 0.15, e * 2.7), 0, rng);
      ads.add(adPlane(5.9, 1.16, adIndex++), null, local(F, -sg * 0.085, 0.95, 0, -sg * Math.PI / 2));
    }
  }

  // ---- bandeiras verticais (feather banners) ----
  for (const sg of [1, -1]) {
    for (let s = sg > 0 ? 108 : 119; s <= 296; s += 22) {
      const f = track.frameAt(s, sg * (hw + 5.6));
      const F = frameMatrix(f);
      structures.add(new THREE.CylinderGeometry(0.05, 0.07, 5.2, 5), poleColor, local(F, 0, 2.6, 0), 0, rng);
      const c = flagCols[Math.floor(rng() * flagCols.length)];
      flags.push({ x: f.x, y: 5.0, z: f.z, rot: f.heading - Math.PI / 2, s: 1, sx: 1.0, sy: 3.4, sz: 1, r: c.r, g: c.g, b: c.b });
    }
  }

  // ---- torres de iluminacao ----
  for (const sg of [1, -1]) {
    for (const s of [125, 215, 300]) {
      const F = frameMatrix(track.frameAt(s, sg * (hw + 7.5)));
      structures.add(new THREE.CylinderGeometry(0.3, 0.75, 27, 6), C('#9aa0a8'), local(F, 0, 13.5, 0), 0, rng);
      structures.add(new THREE.BoxGeometry(1.6, 0.25, 1.6), steel, local(F, 0, 25.6, 0), 0, rng);
      const head = F.clone().multiply(mat(0, 27.3, 0, 0, 1, 1, 1, 0, sg * 0.4));
      structures.add(new THREE.BoxGeometry(0.5, 3.2, 6.5), steel, head, 0, rng);
      lamps.add(new THREE.BoxGeometry(0.12, 2.7, 6.0), null, head.clone().multiply(mat(-sg * 0.32, 0, 0)));
    }
  }

  return { structures: structures.build(), lamps: lamps.build(), ads: ads.build(), crowd, flags };
}

function makeFlagMaterial(timeUniform) {
  const m = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float flagPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
      #else
        float flagPhase = 0.0;
      #endif
      transformed.z += sin(transformed.x * 7.0 - uTime * 5.0 + flagPhase) * 0.15 * clamp(transformed.x * 1.5, 0.0, 1.0);`,
    );
  };
  m.customProgramCacheKey = () => 'env-flag-wave';
  return m;
}

// ---------------------------------------------------------------------------
// API principal
// ---------------------------------------------------------------------------
export function createEnvironment(scene, renderer, track, options = {}) {
  const {
    seed = 1337,
    exposure = 1.0,
    shadowMapSize = 2048,
    shadowExtent = 40,
    fogNear = 140,
    fogFar = 2500,
    environmentIntensity = 0.85,
    sunIntensity = 3.4,
    hemiIntensity = 1.6,
    cloudCover = 0.45,
    density = 1.0,
    shadows = true,
    treeShadows = true,
    lowPoly = false,
  } = options;

  const rng = mulberry32(seed);
  const helpers = makeTrackHelpers(track);
  const group = new THREE.Group();
  group.name = 'environment';
  const disposables = new Set();
  const track_ = (o) => { if (o) disposables.add(o); return o; };

  // ---- renderer ----
  if (renderer) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = exposure;
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = shadows;
      // r187: PCFSoftShadowMap foi removido (cai para PCF); PCF + radius ja e suave.
      renderer.shadowMap.type = THREE.PCFShadowMap;
    }
  }

  // ---- ceu + neblina ----
  const prevFog = scene.fog;
  const prevEnv = scene.environment;
  const prevEnvIntensity = scene.environmentIntensity;
  const ownFog = new THREE.Fog(SKY.horizon, fogNear, fogFar);
  scene.fog = ownFog;

  const skyGeo = track_(new THREE.SphereGeometry(1, 32, 16));
  const skyMat = track_(makeSkyMaterial(false, cloudCover));
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = 'env-sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.matrixAutoUpdate = false;
  group.add(sky);

  let envRT = null;
  if (renderer && renderer.isWebGLRenderer) {
    try {
      const envScene = new THREE.Scene();
      const envMat = makeSkyMaterial(true, cloudCover);
      envScene.add(new THREE.Mesh(skyGeo, envMat));
      const pmrem = new THREE.PMREMGenerator(renderer);
      envRT = pmrem.fromScene(envScene, 0.02);
      pmrem.dispose();
      envMat.dispose();
      scene.environment = envRT.texture;
      scene.environmentIntensity = environmentIntensity;
    } catch (err) {
      console.warn('environment: falha ao gerar mapa de ambiente', err);
    }
  }

  // ---- luzes ----
  const hemi = new THREE.HemisphereLight(0xc4d8f5, 0x77745a, hemiIntensity);
  hemi.name = 'env-hemi';
  group.add(hemi);

  const sun = new THREE.DirectionalLight(0xffd9ae, sunIntensity);
  sun.name = 'env-sun';
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  const extH = shadowExtent;
  const extV = Math.min(shadowExtent, shadowExtent * SUN_DIRECTION.y + 10); // vertical em espaco de luz (sol baixo)
  const cam = sun.shadow.camera;
  cam.left = -extH; cam.right = extH; cam.top = extV; cam.bottom = -extV;
  cam.near = 20; cam.far = SUN_DISTANCE + 150;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2;
  group.add(sun);
  group.add(sun.target);

  // base da camera de sombra (igual a Object3D.lookAt)
  const basisZ = SUN_DIRECTION.clone();
  const basisX = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), basisZ).normalize();
  const basisY = new THREE.Vector3().crossVectors(basisZ, basisX);
  const texelX = (2 * extH) / shadowMapSize;
  const texelY = (2 * extV) / shadowMapSize;
  const lead = new THREE.Vector3();
  const leadTarget = new THREE.Vector3();
  const prevFocus = new THREE.Vector3();
  const center = new THREE.Vector3();
  let hasPrev = false;

  function placeSun(p) {
    const sx = Math.round(p.dot(basisX) / texelX) * texelX;
    const sy = Math.round(p.dot(basisY) / texelY) * texelY;
    const sz = p.dot(basisZ);
    sun.target.position.set(0, 0, 0)
      .addScaledVector(basisX, sx).addScaledVector(basisY, sy).addScaledVector(basisZ, sz);
    sun.position.copy(sun.target.position).addScaledVector(basisZ, SUN_DISTANCE);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }
  {
    const f0 = track.frameAt(track.config ? track.config.startDistance : 40, 0);
    placeSun(new THREE.Vector3(f0.x, f0.y, f0.z));
  }

  // ---- materiais compartilhados ----
  const flatMat = track_(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  flatMat.name = 'env-flat';

  // ---- terreno ----
  const grassTex = track_(makeGrassTexture(renderer, seed + 5));
  const terrain = buildTerrain(helpers, seed, grassTex);
  track_(terrain.mesh.geometry);
  track_(terrain.mesh.material);
  group.add(terrain.mesh);

  // ---- montanhas ----
  const mountains = buildMountains(helpers, rng, flatMat);
  track_(mountains.geometry);
  group.add(mountains);

  // ---- lago ----
  const lake = buildLake(track, helpers, rng);
  for (const m of lake.meshes) {
    track_(m.geometry);
    track_(m.material);
    m.matrixAutoUpdate = false;
    group.add(m);
  }

  // ---- vegetacao ----
  const veg = scatterVegetation(track, helpers, terrain, lake, rng, density);
  const treeGeos = { pine: pineGeometry(rng), round: roundTreeGeometry(rng), poplar: poplarGeometry(rng) };
  const farGeos = lowPoly
    ? { pine: treeGeos.pine, round: roundTreeGeometry(rng, 0), poplar: poplarGeometry(rng, 0) }
    : treeGeos;
  for (const key of Object.keys(treeGeos)) {
    track_(treeGeos[key]);
    track_(farGeos[key]);
    const { near, far } = veg.trees[key];
    if (near.length) group.add(makeInstanced(treeGeos[key], flatMat, near, `env-trees-${key}-near`, { castShadow: shadows && treeShadows }));
    if (far.length) group.add(makeInstanced(farGeos[key], flatMat, far, `env-trees-${key}-far`));
  }
  const bushGeo = track_(bushGeometry(rng, lowPoly ? 0 : 1));
  const rockGeo = track_(rockGeometry(rng));
  if (veg.bushes.length) group.add(makeInstanced(bushGeo, flatMat, veg.bushes, 'env-bushes'));
  if (veg.rocks.length) group.add(makeInstanced(rockGeo, flatMat, veg.rocks, 'env-rocks', { receiveShadow: true }));

  // ---- decoracao da reta ----
  const dressing = buildDressing(track, rng);
  if (dressing.structures) {
    const m = new THREE.Mesh(track_(dressing.structures), flatMat);
    m.name = 'env-structures';
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  if (dressing.lamps) {
    const lampMat = track_(new THREE.MeshBasicMaterial({ color: 0xfff4d8 }));
    const m = new THREE.Mesh(track_(dressing.lamps), lampMat);
    m.name = 'env-lamps';
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  if (dressing.ads) {
    const adsTex = track_(makeAdsTexture(renderer));
    const adsMat = track_(new THREE.MeshLambertMaterial({ color: adsTex ? 0xffffff : 0xd8d8d8, map: adsTex }));
    const m = new THREE.Mesh(track_(dressing.ads), adsMat);
    m.name = 'env-ads';
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  if (dressing.crowd.length) {
    const crowdGeo = track_(new THREE.BoxGeometry(0.44, 1, 0.34).translate(0, 0.5, 0));
    crowdGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(crowdGeo.attributes.position.count * 3).fill(1), 3));
    group.add(makeInstanced(crowdGeo, flatMat, dressing.crowd, 'env-crowd', { receiveShadow: true }));
  }
  const flagTime = { value: 0 };
  if (dressing.flags.length) {
    const flagGeo = track_(new THREE.PlaneGeometry(1, 1, 8, 1).translate(0.5, -0.5, 0));
    const flagMat = track_(makeFlagMaterial(flagTime));
    group.add(makeInstanced(flagGeo, flagMat, dressing.flags, 'env-flags'));
  }

  for (const o of group.children) o.updateMatrix();
  scene.add(group);

  // ---- API ----
  function update(focusPosition, dt = 1 / 60) {
    if (!(dt > 0)) dt = 0;
    skyMat.uniforms.uTime.value += dt;
    flagTime.value += dt;
    if (!focusPosition) return;
    // desloca a sombra um pouco para frente na direcao do movimento
    if (hasPrev && dt > 0) {
      const dx = focusPosition.x - prevFocus.x;
      const dz = focusPosition.z - prevFocus.z;
      if (dx * dx + dz * dz > 2500) lead.set(0, 0, 0); // teletransporte / respawn
      else {
        leadTarget.set((dx / dt) * 0.35, 0, (dz / dt) * 0.35);
        const maxLead = extH * 0.5;
        if (leadTarget.length() > maxLead) leadTarget.setLength(maxLead);
        lead.lerp(leadTarget, 1 - Math.exp(-3 * dt));
      }
    }
    prevFocus.copy(focusPosition);
    hasPrev = true;
    center.copy(focusPosition).add(lead);
    placeSun(center);
  }

  function dispose() {
    scene.remove(group);
    group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    for (const d of disposables) if (d && typeof d.dispose === 'function') d.dispose();
    disposables.clear();
    if (sun.shadow && sun.shadow.map) sun.shadow.map.dispose();
    if (envRT) {
      if (scene.environment === envRT.texture) {
        scene.environment = prevEnv;
        scene.environmentIntensity = prevEnvIntensity;
      }
      envRT.dispose();
      envRT = null;
    }
    if (scene.fog === ownFog) scene.fog = prevFog;
  }

  return {
    sun,
    hemisphere: hemi,
    group,
    sunDirection: SUN_DIRECTION.clone(),
    heightAt: terrain.heightAt,
    update,
    dispose,
  };
}

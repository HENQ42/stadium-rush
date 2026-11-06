// Efeitos de pneu e de batida: marcas de derrapagem, fumaca/poeira e faiscas.
//
//  * marcas: um unico BufferGeometry pre-alocado usado como buffer circular de
//    quads (SKID_SEGMENTS). Cada quad liga a borda anterior da roda a borda
//    atual, formando uma faixa continua por roda; a faixa quebra quando a roda
//    para de derrapar. Somente o trecho alterado e enviado a GPU
//    (addUpdateRange). O desvanecimento das marcas mais antigas e feito no
//    shader a partir do indice do slot (sem reenviar o buffer inteiro);
//  * fumaca: THREE.Points com ShaderMaterial (sprite redondo e "fofo" gerado no
//    shader), pool fixo de SMOKE_POOL particulas compactado a cada quadro;
//  * faiscas: rastros em LineSegments + brilho em Points, ambos aditivos.
//
// Tudo e alocado no construtor; update() nao cria objetos. Nao usa `document`,
// entao pode ser importado/instanciado no Node.
import * as THREE from 'three';

const SKID_SEGMENTS = 4000;
const SKID_MIN_SPEED = 8; // m/s
const SKID_MIN_SEG_LEN = 0.3; // m entre bordas consecutivas
const SKID_MAX_SEG_LEN = 6; // acima disso (respawn/teleporte) a faixa quebra
const SKID_HOLD_TIME = 0.12; // s que a marca continua apos a roda parar de derrapar
const SKID_NORMAL_OFFSET = 0.02;
const SKID_WIDTH_FRONT = 0.32;
const SKID_WIDTH_REAR = 0.42;

const SMOKE_POOL = 600;
const SPARK_POOL = 256;
const SPARK_GRAVITY = 16; // igual a gravidade da fisica
const SPARK_MIN_HIT = 4;

// ---------------- shaders ----------------
const SKID_VERT = /* glsl */ `
attribute float aSide;
attribute float aSlot;
attribute vec2 aInfo; // x = alpha, y = material (0 asfalto, 1 grama)
uniform float uHead;
uniform float uCount;
uniform float uCap;
varying float vAlpha;
varying float vSide;
varying float vMat;
#include <fog_pars_vertex>
void main() {
  float age = mod(uHead - 1.0 - aSlot + uCap, uCap);
  float fade = 1.0 - smoothstep(uCap * 0.55, uCap, age);
  vAlpha = age < uCount ? aInfo.x * fade : 0.0;
  vSide = aSide;
  vMat = aInfo.y;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SKID_FRAG = /* glsl */ `
uniform vec3 uRoadColor;
uniform vec3 uGrassColor;
uniform float uOpacity;
varying float vAlpha;
varying float vSide;
varying float vMat;
#include <fog_pars_fragment>
void main() {
  float edge = smoothstep(0.0, 0.2, vSide) * smoothstep(1.0, 0.8, vSide);
  float a = vAlpha * edge * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(uRoadColor, uGrassColor, vMat), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const SMOKE_VERT = /* glsl */ `
attribute vec4 aData; // x = alpha, y = tamanho (m), z = material, w = semente
uniform float uPixelScale;
uniform float uMaxPointSize;
varying float vAlpha;
varying float vMat;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float depth = max(-mvPosition.z, 0.05);
  float size = aData.y * uPixelScale / depth;
  // some perto da camera (evita tela cheia de fumaca e overdraw)
  float a = aData.x * smoothstep(1.0, 4.0, depth);
  if (size < 1.0) { a *= size; size = 1.0; }
  vAlpha = a;
  vMat = aData.z;
  vSeed = aData.w;
  gl_PointSize = min(size, uMaxPointSize);
  if (a <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  #include <fog_vertex>
}
`;

const SMOKE_FRAG = /* glsl */ `
uniform vec3 uSmokeColor;
uniform vec3 uDustColor;
varying float vAlpha;
varying float vMat;
varying float vSeed;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  float soft = (1.0 - r2);
  soft *= soft;
  float c = cos(vSeed * 6.2831), s = sin(vSeed * 6.2831);
  vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y) * 3.5 + vSeed * 17.0;
  float puff = 0.6 + 0.4 * vnoise(q);
  float a = vAlpha * soft * puff;
  if (a < 0.002) discard;
  vec3 col = mix(uSmokeColor, uDustColor, vMat) * (0.82 + 0.18 * (1.0 - gl_PointCoord.y));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const SPARK_POINT_VERT = /* glsl */ `
attribute float aHeat;
uniform float uPixelScale;
varying float vHeat;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vHeat = aHeat;
  gl_PointSize = clamp(0.12 * uPixelScale / max(-mvPosition.z, 0.05), 1.5, 24.0);
}
`;

const SPARK_POINT_FRAG = /* glsl */ `
varying float vHeat;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  float g = (1.0 - r2);
  g *= g;
  vec3 col = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.85, 0.5), vHeat) * vHeat * g * 1.6;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// gerador pseudo-aleatorio barato (LCG); deixa os efeitos reproduziveis nos testes
let _seed = 1234567;
function rnd() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 4294967296;
}
const rs = (a) => (rnd() * 2 - 1) * a; // simetrico [-a, a]

export class TyreEffects {
  constructor(scene) {
    this.scene = scene;
    this._v2 = new THREE.Vector2();
    this._initSkids();
    this._initSmoke();
    this._initSparks();
    if (scene) {
      scene.add(this.skidMesh);
      scene.add(this.smoke);
      scene.add(this.sparkLines);
      scene.add(this.sparkPoints);
    }
  }

  // ======================= marcas de derrapagem =======================
  _initSkids() {
    const N = SKID_SEGMENTS;
    const geo = new THREE.BufferGeometry();
    this.skidPos = new Float32Array(N * 4 * 3);
    this.skidInfo = new Float32Array(N * 4 * 2);
    const side = new Float32Array(N * 4);
    const slot = new Float32Array(N * 4);
    const index = new Uint16Array(N * 6);
    for (let s = 0; s < N; s++) {
      const v = s * 4;
      // 0 = inicio esq, 1 = inicio dir, 2 = fim esq, 3 = fim dir
      side[v] = 0; side[v + 1] = 1; side[v + 2] = 0; side[v + 3] = 1;
      slot[v] = slot[v + 1] = slot[v + 2] = slot[v + 3] = s;
      const i = s * 6;
      index[i] = v; index[i + 1] = v + 2; index[i + 2] = v + 1;
      index[i + 3] = v + 1; index[i + 4] = v + 2; index[i + 5] = v + 3;
    }
    this.skidPosAttr = new THREE.BufferAttribute(this.skidPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.skidInfoAttr = new THREE.BufferAttribute(this.skidInfo, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.skidPosAttr);
    geo.setAttribute('aInfo', this.skidInfoAttr);
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aSlot', new THREE.BufferAttribute(slot, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.skidUniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uHead: { value: 0 },
        uCount: { value: 0 },
        uCap: { value: N },
        uOpacity: { value: 0.75 },
        uRoadColor: { value: new THREE.Color(0x141414) },
        uGrassColor: { value: new THREE.Color(0x3b2a17) },
      },
    ]);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skidUniforms,
      vertexShader: SKID_VERT,
      fragmentShader: SKID_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      fog: true,
    });
    this.skidMesh = new THREE.Mesh(geo, mat);
    this.skidMesh.name = 'skidMarks';
    this.skidMesh.frustumCulled = false;
    this.skidMesh.matrixAutoUpdate = false;
    this.skidMesh.renderOrder = 1;

    this.skidHead = 0; // proximo slot a escrever
    this.skidCount = 0; // slots validos (<= N)
    this.skidTotal = 0; // total de segmentos ja escritos (estatistica)
    // estado da faixa por roda
    this.strips = [0, 1, 2, 3].map(() => ({
      active: false,
      hasEdge: false,
      p: new Float32Array(3), // ultimo ponto central
      l: new Float32Array(3), // ultima borda esquerda
      r: new Float32Array(3), // ultima borda direita
      alpha: 0,
      hold: 0, // tempo restante de "derrapando" (histerese)
    }));
    this._frameStartSlot = 0;
    this._frameWritten = 0;
    this._skidFullUpload = false;
    // os dois atributos sao enviados juntos no mesmo render
    this.skidInfoAttr.onUpload(() => {
      this._skidFullUpload = false;
    });
    this._nl = new Float32Array(3);
    this._nr = new Float32Array(3);
  }

  _writeSkid(st, nl, nr, alpha, matFlag) {
    const s = this.skidHead;
    const P = this.skidPos;
    const I = this.skidInfo;
    let o = s * 12;
    P[o] = st.l[0]; P[o + 1] = st.l[1]; P[o + 2] = st.l[2];
    P[o + 3] = st.r[0]; P[o + 4] = st.r[1]; P[o + 5] = st.r[2];
    P[o + 6] = nl[0]; P[o + 7] = nl[1]; P[o + 8] = nl[2];
    P[o + 9] = nr[0]; P[o + 10] = nr[1]; P[o + 11] = nr[2];
    o = s * 8;
    I[o] = st.alpha; I[o + 1] = matFlag;
    I[o + 2] = st.alpha; I[o + 3] = matFlag;
    I[o + 4] = alpha; I[o + 5] = matFlag;
    I[o + 6] = alpha; I[o + 7] = matFlag;

    this._frameWritten++;
    this.skidHead = (s + 1) % SKID_SEGMENTS;
    if (this.skidCount < SKID_SEGMENTS) this.skidCount++;
    this.skidTotal++;
  }

  // Envia a GPU so os slots escritos neste quadro: [inicio, inicio + n), que
  // pode dar a volta no fim do buffer circular (vira duas faixas).
  _flushSkids() {
    const n = this._frameWritten;
    if (n === 0) return;
    const pa = this.skidPosAttr;
    const ia = this.skidInfoAttr;
    pa.needsUpdate = true;
    ia.needsUpdate = true;
    this._frameWritten = 0;
    // As faixas acumulam ate o proximo render (o renderer as limpa apos enviar).
    // Se acumularem demais (objeto sem render), envia o buffer inteiro no
    // proximo upload (sem faixas = upload completo).
    if (this._skidFullUpload) return;
    if (pa.updateRanges.length > 32) {
      pa.clearUpdateRanges();
      ia.clearUpdateRanges();
      this._skidFullUpload = true;
      return;
    }
    const start = this._frameStartSlot;
    const first = Math.min(n, SKID_SEGMENTS - start);
    pa.addUpdateRange(start * 12, first * 12);
    ia.addUpdateRange(start * 8, first * 8);
    if (first < n) {
      pa.addUpdateRange(0, (n - first) * 12);
      ia.addUpdateRange(0, (n - first) * 8);
    }
  }

  _updateSkids(car, speed, dt) {
    const wheels = car.wheels;
    const brakingHard = !!car.braking && speed > SKID_MIN_SPEED;
    const speedAlpha = Math.min(1, 0.45 + (speed - SKID_MIN_SPEED) / 25);
    const nl = this._nl;
    const nr = this._nr;
    this._frameStartSlot = this.skidHead;
    this._frameWritten = 0;
    for (let i = 0; i < wheels.length && i < 4; i++) {
      const w = wheels[i];
      const st = this.strips[i];
      // isSliding pisca de um passo de fisica para outro (sobretudo no drift no
      // freio); segurar o estado um instante evita faixas picotadas
      if (w.contact && (w.isSliding || brakingHard)) st.hold = SKID_HOLD_TIME;
      else st.hold -= dt;
      const on = w.contact && speed > SKID_MIN_SPEED && st.hold > 0;
      if (!on) {
        st.active = false;
        continue;
      }
      const n = w.normal;
      const cp = w.contactPoint;
      const px = cp[0] + n[0] * SKID_NORMAL_OFFSET;
      const py = cp[1] + n[1] * SKID_NORMAL_OFFSET;
      const pz = cp[2] + n[2] * SKID_NORMAL_OFFSET;
      if (!st.active) {
        st.active = true;
        st.hasEdge = false;
        st.p[0] = px; st.p[1] = py; st.p[2] = pz;
        st.alpha = 0; // entrada suave
        continue;
      }
      let dx = px - st.p[0], dy = py - st.p[1], dz = pz - st.p[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist > SKID_MAX_SEG_LEN) {
        st.hasEdge = false;
        st.p[0] = px; st.p[1] = py; st.p[2] = pz;
        st.alpha = 0;
        continue;
      }
      if (dist < SKID_MIN_SEG_LEN) continue;
      dx /= dist; dy /= dist; dz /= dist;
      // lateral = normal x direcao
      let sx = n[1] * dz - n[2] * dy;
      let sy = n[2] * dx - n[0] * dz;
      let sz = n[0] * dy - n[1] * dx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const half = (w.steer ? SKID_WIDTH_FRONT : SKID_WIDTH_REAR) * 0.5;
      sx *= half / sl; sy *= half / sl; sz *= half / sl;
      if (!st.hasEdge) {
        st.l[0] = st.p[0] + sx; st.l[1] = st.p[1] + sy; st.l[2] = st.p[2] + sz;
        st.r[0] = st.p[0] - sx; st.r[1] = st.p[1] - sy; st.r[2] = st.p[2] - sz;
        st.hasEdge = true;
      }
      nl[0] = px + sx; nl[1] = py + sy; nl[2] = pz + sz;
      nr[0] = px - sx; nr[1] = py - sy; nr[2] = pz - sz;
      const grass = w.materialName !== 'road'; // grama ou terra
      const alpha = speedAlpha * (grass ? 0.8 : 1);
      this._writeSkid(st, nl, nr, alpha, grass ? 1 : 0);
      st.l[0] = nl[0]; st.l[1] = nl[1]; st.l[2] = nl[2];
      st.r[0] = nr[0]; st.r[1] = nr[1]; st.r[2] = nr[2];
      st.p[0] = px; st.p[1] = py; st.p[2] = pz;
      st.alpha = alpha;
    }
    this._flushSkids();
    this.skidUniforms.uHead.value = this.skidHead;
    this.skidUniforms.uCount.value = this.skidCount;
  }

  // ============================ fumaca ============================
  _initSmoke() {
    const N = SMOKE_POOL;
    this.sm = {
      n: 0,
      px: new Float32Array(N), py: new Float32Array(N), pz: new Float32Array(N),
      vx: new Float32Array(N), vy: new Float32Array(N), vz: new Float32Array(N),
      age: new Float32Array(N), life: new Float32Array(N),
      s0: new Float32Array(N), s1: new Float32Array(N),
      a: new Float32Array(N), mat: new Float32Array(N), seed: new Float32Array(N),
    };
    this.smokeAcc = new Float32Array(4);
    const geo = new THREE.BufferGeometry();
    this.smokePos = new Float32Array(N * 3);
    this.smokeData = new Float32Array(N * 4);
    this.smokePosAttr = new THREE.BufferAttribute(this.smokePos, 3).setUsage(THREE.DynamicDrawUsage);
    this.smokeDataAttr = new THREE.BufferAttribute(this.smokeData, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.smokePosAttr);
    geo.setAttribute('aData', this.smokeDataAttr);
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.smokeUniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uPixelScale: { value: 800 },
        uMaxPointSize: { value: 320 },
        uSmokeColor: { value: new THREE.Color(0xdcdcdf) },
        uDustColor: { value: new THREE.Color(0x8a7050) },
      },
    ]);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.smokeUniforms,
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.smoke = new THREE.Points(geo, mat);
    this.smoke.name = 'tyreSmoke';
    this.smoke.frustumCulled = false;
    this.smoke.matrixAutoUpdate = false;
    this.smoke.renderOrder = 2;
    this.smoke.visible = false;
    const v2 = this._v2;
    const u = this.smokeUniforms;
    this.smoke.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(v2);
      u.uPixelScale.value = camera.projectionMatrix.elements[5] * v2.y * 0.5;
      u.uMaxPointSize.value = Math.max(64, v2.y * 0.3);
    };
  }

  _emitSmoke(x, y, z, car, n, grass) {
    const sm = this.sm;
    if (sm.n >= SMOKE_POOL) return;
    const i = sm.n++;
    const up = 0.6 + rnd() * 0.6;
    sm.px[i] = x + rs(0.15); sm.py[i] = y + 0.12; sm.pz[i] = z + rs(0.15);
    sm.vx[i] = car.vel[0] * 0.25 + rs(0.8) + n[0] * up;
    sm.vy[i] = car.vel[1] * 0.1 + rnd() * 0.3 + n[1] * up;
    sm.vz[i] = car.vel[2] * 0.25 + rs(0.8) + n[2] * up;
    sm.age[i] = 0;
    if (grass) {
      sm.life[i] = 1.0 + rnd() * 0.6;
      sm.s0[i] = 0.6; sm.s1[i] = 3.0 + rnd();
      sm.a[i] = 0.45; sm.mat[i] = 1;
    } else {
      sm.life[i] = 1.2 + rnd() * 0.6;
      sm.s0[i] = 0.5; sm.s1[i] = 2.6 + rnd();
      sm.a[i] = 0.35; sm.mat[i] = 0;
    }
    sm.seed[i] = rnd();
  }

  _updateSmoke(car, speed, dt) {
    const wheels = car.wheels;
    for (let i = 0; i < wheels.length && i < 4; i++) {
      const w = wheels[i];
      let rate = 0;
      if (w.contact) {
        const grass = w.materialName !== 'road'; // grama ou terra: poeira
        const slide = w.isSliding && speed > 6 && (!w.steer || car.braking);
        if (slide) rate += (grass ? 30 : 18) + speed * 1.1;
        else if (grass && speed > 10) rate += speed * 0.7; // poeira mesmo sem derrapar
        if (rate > 0) {
          this.smokeAcc[i] += rate * dt;
          let k = 0;
          const cp = w.contactPoint;
          while (this.smokeAcc[i] >= 1 && k < 8) {
            this.smokeAcc[i] -= 1;
            k++;
            this._emitSmoke(cp[0], cp[1], cp[2], car, w.normal, grass);
          }
          if (this.smokeAcc[i] > 1) this.smokeAcc[i] = 1;
        }
      }
      if (rate === 0) this.smokeAcc[i] = 0;
    }

    // simulacao + compactacao (troca com o ultimo vivo)
    const sm = this.sm;
    const drag = Math.exp(-1.6 * dt);
    const buoy = 0.7 * dt;
    const P = this.smokePos;
    const D = this.smokeData;
    let i = 0;
    while (i < sm.n) {
      const age = sm.age[i] + dt;
      if (age >= sm.life[i]) {
        const last = --sm.n;
        if (i !== last) {
          sm.px[i] = sm.px[last]; sm.py[i] = sm.py[last]; sm.pz[i] = sm.pz[last];
          sm.vx[i] = sm.vx[last]; sm.vy[i] = sm.vy[last]; sm.vz[i] = sm.vz[last];
          sm.age[i] = sm.age[last]; sm.life[i] = sm.life[last];
          sm.s0[i] = sm.s0[last]; sm.s1[i] = sm.s1[last];
          sm.a[i] = sm.a[last]; sm.mat[i] = sm.mat[last]; sm.seed[i] = sm.seed[last];
        }
        continue; // reprocessa o slot i (agora com a particula trazida do fim)
      }
      sm.age[i] = age;
      sm.vx[i] *= drag; sm.vy[i] = sm.vy[i] * drag + buoy; sm.vz[i] *= drag;
      sm.px[i] += sm.vx[i] * dt; sm.py[i] += sm.vy[i] * dt; sm.pz[i] += sm.vz[i] * dt;
      const t = age / sm.life[i];
      const inv = 1 - t;
      const fadeIn = t < 0.08 ? t / 0.08 : 1;
      const o3 = i * 3, o4 = i * 4;
      P[o3] = sm.px[i]; P[o3 + 1] = sm.py[i]; P[o3 + 2] = sm.pz[i];
      D[o4] = sm.a[i] * fadeIn * inv * Math.sqrt(inv);
      D[o4 + 1] = sm.s0[i] + (sm.s1[i] - sm.s0[i]) * (1 - inv * inv);
      D[o4 + 2] = sm.mat[i];
      D[o4 + 3] = sm.seed[i];
      i++;
    }
    const geo = this.smoke.geometry;
    geo.setDrawRange(0, sm.n);
    this.smoke.visible = sm.n > 0;
    if (sm.n > 0) {
      this._markRange(this.smokePosAttr, sm.n * 3);
      this._markRange(this.smokeDataAttr, sm.n * 4);
    }
  }

  // ============================ faiscas ============================
  _initSparks() {
    const N = SPARK_POOL;
    this.sp = {
      n: 0,
      px: new Float32Array(N), py: new Float32Array(N), pz: new Float32Array(N),
      vx: new Float32Array(N), vy: new Float32Array(N), vz: new Float32Array(N),
      age: new Float32Array(N), life: new Float32Array(N),
    };
    this.sparkCooldown = 0;
    this.sparkBursts = 0;
    this._prevLocalVelX = 0;
    this._proj = {};

    // rastros
    const lg = new THREE.BufferGeometry();
    this.sparkLinePos = new Float32Array(N * 2 * 3);
    this.sparkLineCol = new Float32Array(N * 2 * 3);
    this.sparkLinePosAttr = new THREE.BufferAttribute(this.sparkLinePos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sparkLineColAttr = new THREE.BufferAttribute(this.sparkLineCol, 3).setUsage(THREE.DynamicDrawUsage);
    lg.setAttribute('position', this.sparkLinePosAttr);
    lg.setAttribute('color', this.sparkLineColAttr);
    lg.setDrawRange(0, 0);
    lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const lm = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.sparkLines = new THREE.LineSegments(lg, lm);
    this.sparkLines.name = 'sparkTrails';
    this.sparkLines.frustumCulled = false;
    this.sparkLines.matrixAutoUpdate = false;
    this.sparkLines.renderOrder = 3;
    this.sparkLines.visible = false;

    // brilho na ponta
    const pg = new THREE.BufferGeometry();
    this.sparkPtPos = new Float32Array(N * 3);
    this.sparkPtHeat = new Float32Array(N);
    this.sparkPtPosAttr = new THREE.BufferAttribute(this.sparkPtPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sparkPtHeatAttr = new THREE.BufferAttribute(this.sparkPtHeat, 1).setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('position', this.sparkPtPosAttr);
    pg.setAttribute('aHeat', this.sparkPtHeatAttr);
    pg.setDrawRange(0, 0);
    pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.sparkUniforms = { uPixelScale: { value: 800 } };
    const pm = new THREE.ShaderMaterial({
      uniforms: this.sparkUniforms,
      vertexShader: SPARK_POINT_VERT,
      fragmentShader: SPARK_POINT_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sparkPoints = new THREE.Points(pg, pm);
    this.sparkPoints.name = 'sparkGlow';
    this.sparkPoints.frustumCulled = false;
    this.sparkPoints.matrixAutoUpdate = false;
    this.sparkPoints.renderOrder = 3;
    this.sparkPoints.visible = false;
    const v2 = this._v2;
    const u = this.sparkUniforms;
    this.sparkPoints.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(v2);
      u.uPixelScale.value = camera.projectionMatrix.elements[5] * v2.y * 0.5;
    };
  }

  _burstSparks(car) {
    const R = car.R;
    const pos = car.pos;
    // direcao (horizontal, mundo) do carro para o muro
    let wx = 0, wz = 0;
    const track = car.track;
    const pr = track && typeof track.project === 'function' ? track.project(pos[0], pos[2], this._proj) : null;
    if (pr && typeof pr.lx === 'number' && track.halfWidth) {
      const sign = pr.u > 0 ? 1 : -1;
      const thick = (track.config && track.config.wallThickness) || 0;
      const inside = Math.abs(pr.u) < track.halfWidth + thick * 0.5;
      wx = (inside ? sign : -sign) * pr.lx;
      wz = (inside ? sign : -sign) * pr.lz;
    } else {
      // aproximacao: lado do carro para onde ele se movia lateralmente
      const lx = Math.abs(this._prevLocalVelX) > 0.5 ? this._prevLocalVelX : car.localVel[0];
      const s = lx >= 0 ? 1 : -1; // +X local = esquerda
      wx = R[0] * s; wz = R[2] * s;
      const l = Math.hypot(wx, wz) || 1;
      wx /= l; wz /= l;
    }
    const fx = R[6], fy = R[7], fz = R[8];
    const hit = car.wallHit;
    const count = Math.round(Math.min(40, Math.max(12, 10 + hit * 1.3)));
    const sp = this.sp;
    const v = car.vel;
    for (let k = 0; k < count && sp.n < SPARK_POOL; k++) {
      const i = sp.n++;
      const along = -1.6 + rnd() * 3.8; // ao longo do carro
      sp.px[i] = pos[0] + wx * 1.05 + fx * along;
      sp.py[i] = pos[1] - 0.25 + rnd() * 0.35 + fy * along;
      sp.pz[i] = pos[2] + wz * 1.05 + fz * along;
      const away = 1 + rnd() * 4;
      const spread = 2 + hit * 0.15;
      sp.vx[i] = v[0] * 0.6 - wx * away + rs(spread);
      sp.vy[i] = 1 + rnd() * 4.5;
      sp.vz[i] = v[2] * 0.6 - wz * away + rs(spread);
      sp.age[i] = 0;
      sp.life[i] = 0.25 + rnd() * 0.2;
    }
    this.sparkBursts++;
  }

  _updateSparks(car, dt) {
    this.sparkCooldown = Math.max(0, this.sparkCooldown - dt);
    if (car.wallHit > SPARK_MIN_HIT && this.sparkCooldown <= 0) {
      this.sparkCooldown = 0.08;
      this._burstSparks(car);
    }
    this._prevLocalVelX = car.localVel[0];

    const sp = this.sp;
    const LP = this.sparkLinePos, LC = this.sparkLineCol;
    const PP = this.sparkPtPos, PH = this.sparkPtHeat;
    const g = SPARK_GRAVITY * dt;
    const drag = Math.exp(-1.2 * dt);
    let i = 0;
    while (i < sp.n) {
      const age = sp.age[i] + dt;
      if (age >= sp.life[i]) {
        const last = --sp.n;
        if (i !== last) {
          sp.px[i] = sp.px[last]; sp.py[i] = sp.py[last]; sp.pz[i] = sp.pz[last];
          sp.vx[i] = sp.vx[last]; sp.vy[i] = sp.vy[last]; sp.vz[i] = sp.vz[last];
          sp.age[i] = sp.age[last]; sp.life[i] = sp.life[last];
        }
        continue;
      }
      sp.age[i] = age;
      sp.vx[i] *= drag; sp.vy[i] = sp.vy[i] * drag - g; sp.vz[i] *= drag;
      sp.px[i] += sp.vx[i] * dt; sp.py[i] += sp.vy[i] * dt; sp.pz[i] += sp.vz[i] * dt;
      const heat = 1 - age / sp.life[i];
      const o = i * 6;
      LP[o] = sp.px[i]; LP[o + 1] = sp.py[i]; LP[o + 2] = sp.pz[i];
      LP[o + 3] = sp.px[i] - sp.vx[i] * 0.03;
      LP[o + 4] = sp.py[i] - sp.vy[i] * 0.03;
      LP[o + 5] = sp.pz[i] - sp.vz[i] * 0.03;
      // cabeca quente (amarelo) -> esfriando (laranja); cauda mais fraca
      const r = 1.6 * heat, gg = (0.35 + 0.45 * heat) * heat * 1.4, b = 0.12 * heat * heat;
      LC[o] = r; LC[o + 1] = gg; LC[o + 2] = b;
      LC[o + 3] = r * 0.25; LC[o + 4] = gg * 0.2; LC[o + 5] = b * 0.1;
      const o3 = i * 3;
      PP[o3] = sp.px[i]; PP[o3 + 1] = sp.py[i]; PP[o3 + 2] = sp.pz[i];
      PH[i] = heat;
      i++;
    }
    this.sparkLines.geometry.setDrawRange(0, sp.n * 2);
    this.sparkPoints.geometry.setDrawRange(0, sp.n);
    const vis = sp.n > 0;
    this.sparkLines.visible = vis;
    this.sparkPoints.visible = vis;
    if (vis) {
      this._markRange(this.sparkLinePosAttr, sp.n * 6);
      this._markRange(this.sparkLineColAttr, sp.n * 6);
      this._markRange(this.sparkPtPosAttr, sp.n * 3);
      this._markRange(this.sparkPtHeatAttr, sp.n);
    }
  }

  _markRange(attr, count) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, count);
    attr.needsUpdate = true;
  }

  // ============================ API ============================
  update(car, dt) {
    if (!car || !car.wheels) return;
    dt = dt > 0.1 ? 0.1 : dt > 0 ? dt : 0;
    const v = car.vel;
    const speed = Math.hypot(v[0], v[1], v[2]);
    this._updateSkids(car, speed, dt);
    this._updateSmoke(car, speed, dt);
    this._updateSparks(car, dt);
  }

  // Limpa marcas e particulas (respawn/reinicio).
  reset() {
    this.skidHead = 0;
    this.skidCount = 0;
    this.skidUniforms.uHead.value = 0;
    this.skidUniforms.uCount.value = 0;
    this._frameWritten = 0;
    for (const st of this.strips) {
      st.active = false;
      st.hasEdge = false;
      st.hold = 0;
    }
    this.sm.n = 0;
    this.smokeAcc.fill(0);
    this.smoke.geometry.setDrawRange(0, 0);
    this.smoke.visible = false;
    this.sp.n = 0;
    this.sparkCooldown = 0;
    this.sparkLines.geometry.setDrawRange(0, 0);
    this.sparkPoints.geometry.setDrawRange(0, 0);
    this.sparkLines.visible = false;
    this.sparkPoints.visible = false;
  }

  dispose() {
    for (const o of [this.skidMesh, this.smoke, this.sparkLines, this.sparkPoints]) {
      if (o.parent) o.parent.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
  }
}

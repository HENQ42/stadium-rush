// Carros dos outros jogadores: modelos, interpolacao dos estados recebidos,
// nomes sobre os carros e colisao carro-carro (opcional por sala).
import * as THREE from 'three';
import { createCarModel } from '../scene/carModel.js';
import { PLAYER_COLORS, F_BRAKE, F_TURBO, F_GHOST, F_SLIDE, F_GROUND, F_REVERSE } from '../net/protocol.js';

const INTERP_DELAY = 70; // ms de atraso de render para interpolar entre pacotes
const MAX_EXTRAPOLATE = 250; // ms
const STALE_MS = 3000; // sem estado ha 3 s: esconde o carro
const WHEEL_RADIUS = 0.38;

// Deixa o modelo translucido (fantasma, como no TrackMania).
function makeGhost(model) {
  model.group.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.transparent) continue; // chamas/blur ja controlam a opacidade
      m.transparent = true;
      m.opacity = 0.42;
      m.depthWrite = false;
      m.needsUpdate = true;
    }
  });
}

class RemoteCar {
  constructor(id, player, ghost) {
    this.id = id;
    this.name = player?.name || '?';
    this.colorIndex = player?.color ?? 0;
    const c = PLAYER_COLORS[this.colorIndex % PLAYER_COLORS.length];
    this.model = createCarModel({ bodyColor: c.body, secondaryColor: c.secondary, accentColor: c.accent, number: String(this.colorIndex + 1) });
    this.ghostModel = ghost;
    if (ghost) makeGhost(this.model);
    this.snaps = [];
    this.lastSeq = -1;
    this.lastRecv = 0;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.visible = false;
    this.wheelSpin = 0;
    this.latest = null;
    // "carro" falso para a camera de espectador e o audio
    this.pseudo = {
      speed: 0,
      vel: [0, 0, 0],
      localVel: [0, 0, 0],
      grounded: true,
      turboTime: 0,
      wallHit: 0,
      anySliding: false,
      reverseMode: false,
      input: { gas: 0, brake: 0 },
      wheels: [],
      tun: { turboDuration: 1.2 },
    };
    this.wheelState = { steerAngle: 0, wheelSpin: [0, 0, 0, 0], suspension: [0, 0, 0, 0], braking: false, speedKmh: 0, boost: 0, dt: 0 };
    this.tag = document.createElement('div');
    this.tag.className = 'name-tag';
    this.tag.style.setProperty('--c', c.css);
    this.tag.textContent = this.name;
  }

  setName(name) {
    if (name && name !== this.name) {
      this.name = name;
      this.tag.textContent = name;
    }
  }

  push(st) {
    if (st.n <= this.lastSeq && this.lastSeq - st.n < 1000) return; // pacote atrasado (canal nao ordenado)
    this.lastSeq = st.n;
    this.lastRecv = performance.now();
    this.latest = st;
    const s = this.snaps;
    s.push(st);
    s.sort((a, b) => a.h - b.h);
    while (s.length > 30) s.shift();
  }

  // Pose no instante t (relogio do master).
  sample(t, outPos, outQuat) {
    const s = this.snaps;
    if (!s.length) return false;
    let a = s[0];
    if (t <= a.h) {
      outPos.fromArray(a.p);
      outQuat.fromArray(a.q);
      return true;
    }
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].h <= t) {
        a = s[i];
        const b = s[i + 1];
        if (b) {
          const k = (t - a.h) / Math.max(1, b.h - a.h);
          outPos.set(a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k);
          _qa.fromArray(a.q);
          _qb.fromArray(b.q);
          outQuat.slerpQuaternions(_qa, _qb, k);
        } else {
          const dt = Math.min(MAX_EXTRAPOLATE, t - a.h) / 1000;
          outPos.set(a.p[0] + a.v[0] * dt, a.p[1] + a.v[1] * dt, a.p[2] + a.v[2] * dt);
          outQuat.fromArray(a.q);
        }
        return true;
      }
    }
    return false;
  }

  update(dt, hostNow) {
    const st = this.latest;
    const fresh = st && performance.now() - this.lastRecv < STALE_MS;
    this.visible = !!fresh && this.sample(hostNow - INTERP_DELAY, this.pos, this.quat);
    this.model.group.visible = this.visible;
    if (!this.visible) return;
    this.model.group.position.copy(this.pos);
    this.model.group.quaternion.copy(this.quat);
    const kmh = st.k * 3.6;
    this.wheelSpin += (st.k / WHEEL_RADIUS) * dt;
    const ws = this.wheelState;
    ws.steerAngle = st.s;
    ws.wheelSpin.fill(this.wheelSpin);
    ws.braking = !!(st.f & F_BRAKE);
    ws.speedKmh = kmh;
    ws.boost = st.f & F_TURBO ? 1 : 0;
    ws.grounded = !!(st.f & F_GROUND);
    ws.dt = dt;
    this.model.update(ws);
    // ghost temporario (respawn) tambem fica translucido? so sinalizamos no nome
    this.tag.classList.toggle('ghost', !!(st.f & F_GHOST));
    const ps = this.pseudo;
    ps.vel[0] = st.v[0]; ps.vel[1] = st.v[1]; ps.vel[2] = st.v[2];
    ps.speed = Math.hypot(st.v[0], st.v[1], st.v[2]);
    ps.localVel[2] = st.k;
    ps.grounded = !!(st.f & F_GROUND);
    ps.turboTime = st.f & F_TURBO ? 0.6 : 0;
    ps.anySliding = !!(st.f & F_SLIDE);
    ps.reverseMode = !!(st.f & F_REVERSE);
    ps.input.gas = st.a;
    ps.input.brake = st.f & F_BRAKE ? 1 : 0;
  }

  // Pose atual estimada (sem atraso) para a colisao.
  predict(hostNow, out) {
    const st = this.latest;
    if (!st || performance.now() - this.lastRecv > 500) return null;
    const dt = Math.max(0, Math.min(MAX_EXTRAPOLATE, hostNow - st.h)) / 1000;
    out.x = st.p[0] + st.v[0] * dt;
    out.y = st.p[1] + st.v[1] * dt;
    out.z = st.p[2] + st.v[2] * dt;
    _qa.fromArray(st.q);
    // eixo Z local (frente) e X local (esquerda) no mundo
    _v.set(0, 0, 1).applyQuaternion(_qa);
    out.fx = _v.x; out.fz = _v.z;
    _v.set(1, 0, 0).applyQuaternion(_qa);
    out.lx = _v.x; out.lz = _v.z;
    out.vx = st.v[0]; out.vy = st.v[1]; out.vz = st.v[2];
    out.ghost = !!(st.f & F_GHOST);
    return out;
  }

  dispose() {
    this.model.dispose();
    this.tag.remove();
  }
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class RemoteCars {
  constructor(tagRoot) {
    this.cars = new Map();
    this.scene = null;
    this.ghost = true;
    this.tagRoot = tagRoot;
    this._p = new THREE.Vector3();
  }

  setScene(scene) {
    this.scene = scene;
    for (const c of this.cars.values()) scene.add(c.model.group);
  }

  // ghost = true quando a sala nao tem colisao
  setGhost(ghost) {
    if (ghost === this.ghost) return;
    this.ghost = ghost;
    this.clear();
  }

  get(id) {
    return this.cars.get(id) || null;
  }

  ensure(id, player) {
    let c = this.cars.get(id);
    if (!c) {
      c = new RemoteCar(id, player, this.ghost);
      this.cars.set(id, c);
      if (this.scene) this.scene.add(c.model.group);
      this.tagRoot.appendChild(c.tag);
    } else if (player) c.setName(player.name);
    return c;
  }

  push(id, st, player) {
    this.ensure(id, player).push(st);
  }

  remove(id) {
    const c = this.cars.get(id);
    if (!c) return;
    c.dispose();
    this.cars.delete(id);
  }

  clear() {
    for (const id of [...this.cars.keys()]) this.remove(id);
  }

  // Remove carros de quem nao esta mais correndo.
  retain(isRacing) {
    for (const id of [...this.cars.keys()]) if (!isRacing(id)) this.remove(id);
  }

  update(dt, hostNow) {
    for (const c of this.cars.values()) c.update(dt, hostNow);
  }

  // nomes sobre os carros (depois de posicionar a camera)
  updateTags(camera) {
    const w = window.innerWidth, h = window.innerHeight;
    for (const c of this.cars.values()) {
      let show = false;
      if (c.visible && camera) {
        const p = this._p.copy(c.pos);
        p.y += 1.5;
        const dist = p.distanceTo(camera.position);
        p.project(camera);
        if (p.z < 1 && dist < 450 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1) {
          show = true;
          const x = (p.x * 0.5 + 0.5) * w;
          const y = (-p.y * 0.5 + 0.5) * h;
          const sc = Math.max(0.55, Math.min(1, 40 / Math.max(1, dist)));
          c.tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${sc.toFixed(2)})`;
        }
      }
      c.tag.style.display = show ? '' : 'none';
    }
  }
}

// ---------------------------------------------------------------------------
// Colisao carro-carro: retangulos orientados no plano (SAT). Cada jogador
// resolve apenas o proprio carro com metade do impulso; o outro lado faz o
// mesmo com a visao dele, e a soma fica parecida com um choque entre massas
// iguais.
// ---------------------------------------------------------------------------
const HX = 1.12; // meia largura
const HZ = 2.3; // meio comprimento
const CZ = 0.23; // centro do retangulo a frente do centro de massa
const RESTITUTION = 0.25;
const _o = {};
const _dw = [0, 0, 0];
const YAW_SCALE = 0.05; // como o impulso angular dos muros

function projRadius(fx, fz, lx, lz, ax, az) {
  return HZ * Math.abs(fx * ax + fz * az) + HX * Math.abs(lx * ax + lz * az);
}

export function collideCar(car, remotes, hostNow, selfGhost) {
  if (selfGhost) return 0;
  const R = car.R;
  const fx1 = R[6], fz1 = R[8];
  const l1 = Math.hypot(fx1, fz1) || 1;
  const f1x = fx1 / l1, f1z = fz1 / l1;
  const l1x = f1z, l1z = -f1x; // esquerda no plano
  const c1x = car.pos[0] + f1x * CZ, c1z = car.pos[2] + f1z * CZ;
  let hit = 0;
  for (const rc of remotes.cars.values()) {
    const o = rc.predict(hostNow, _o);
    if (!o || o.ghost) continue;
    if (Math.abs(o.y - car.pos[1]) > 1.6) continue;
    const l2 = Math.hypot(o.fx, o.fz) || 1;
    const f2x = o.fx / l2, f2z = o.fz / l2;
    const l2x = f2z, l2z = -f2x;
    const c2x = o.x + f2x * CZ, c2z = o.z + f2z * CZ;
    const dx = c1x - c2x, dz = c1z - c2z;
    if (dx * dx + dz * dz > 30) continue;
    let minPen = Infinity, nx = 0, nz = 0;
    for (const [ax, az] of [[f1x, f1z], [l1x, l1z], [f2x, f2z], [l2x, l2z]]) {
      const d = dx * ax + dz * az;
      const pen = projRadius(f1x, f1z, l1x, l1z, ax, az) + projRadius(f2x, f2z, l2x, l2z, ax, az) - Math.abs(d);
      if (pen <= 0) {
        minPen = -1;
        break;
      }
      if (pen < minPen) {
        minPen = pen;
        const sg = d >= 0 ? 1 : -1; // normal aponta do outro para mim
        nx = ax * sg;
        nz = az * sg;
      }
    }
    if (minPen <= 0) continue;
    // separa metade da penetracao
    const push = Math.min(minPen, 1.2) * 0.5;
    car.pos[0] += nx * push;
    car.pos[2] += nz * push;
    // ponto de contato aproximado: entre os dois centros
    const r = [(c2x - car.pos[0]) * 0.5 + (c1x - car.pos[0]) * 0.5, 0, (c2z - car.pos[2]) * 0.5 + (c1z - car.pos[2]) * 0.5];
    const w = car.angVel;
    const vpx = car.vel[0] + (w[1] * r[2] - w[2] * r[1]);
    const vpz = car.vel[2] + (w[0] * r[1] - w[1] * r[0]);
    const vn = (vpx - o.vx) * nx + (vpz - o.vz) * nz;
    if (vn >= 0) continue;
    const j = (-(1 + RESTITUTION) * vn) / 2;
    car.vel[0] += nx * j;
    car.vel[2] += nz * j;
    // um pouco de giro em yaw pelo ponto de contato (fraco para nao rodar o carro)
    const torqueY = r[2] * nx * j - r[0] * nz * j;
    const dw = car.applyInvInertia([0, torqueY, 0], _dw);
    car.angVel[1] += dw[1] * YAW_SCALE;
    hit = Math.max(hit, -vn);
  }
  if (hit > 0.5) car.wallHit = Math.max(car.wallHit, hit);
  return hit;
}

// Geometria da pista sem dependencia do three.js (usada pela fisica e pela
// renderizacao). Gera amostras da linha central, inclinacao das curvas e
// responde consultas de chao/muro por posicao.
import { TRACK_POINTS, TRACK_CONFIG } from './trackData.js';

export const TERRAIN_Y = 0;
const EMBANKMENT_SLOPE = 1.0; // talude de 45 graus fora da pista
const GRID_CELL = 16;
const GRID_MARGIN = 45; // alcance lateral (m) indexado na grade

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function sampleSpline(points, perSegment) {
  const n = points.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment;
      out.push([0, 1, 2, 3].map((c) => catmullRom(p0[c], p1[c], p2[c], p3[c], t)));
    }
  }
  return out;
}

function resampleByLength(dense, spacing) {
  // comprimento acumulado (no plano XZ)
  const n = dense.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) {
    const a = dense[i - 1];
    const b = dense[i % n];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[n];
  const count = Math.round(total / spacing);
  const step = total / count;
  const out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const s = k * step;
    while (cum[j + 1] < s) j++;
    const a = dense[j];
    const b = dense[(j + 1) % n];
    const t = (s - cum[j]) / (cum[j + 1] - cum[j]);
    out.push(a.map((v, c) => v + (b[c] - v) * t));
  }
  return { samples: out, length: total, step };
}

function smoothCircular(values, radius, passes = 1) {
  let v = values.slice();
  const n = v.length;
  for (let p = 0; p < passes; p++) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += v[(i + k + n) % n];
      out[i] = sum / (2 * radius + 1);
    }
    v = out;
  }
  return v;
}

export class TrackPath {
  constructor(points = TRACK_POINTS, config = TRACK_CONFIG) {
    this.config = config;
    this.halfWidth = config.halfWidth;
    const dense = sampleSpline(points, 60);
    const { samples, length, step } = resampleByLength(dense, config.sampleSpacing);
    this.length = length;
    this.step = step;
    const n = samples.length;
    this.count = n;

    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.pz = new Float64Array(n);
    this.tx = new Float64Array(n); // tangente horizontal
    this.tz = new Float64Array(n);
    this.lx = new Float64Array(n); // esquerda horizontal (up x tangente)
    this.lz = new Float64Array(n);
    this.slope = new Float64Array(n); // dy/ds
    this.bank = new Float64Array(n); // rad, positivo levanta o lado esquerdo
    this.curv = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      this.px[i] = samples[i][0];
      this.pz[i] = samples[i][1];
    }
    // altura suavizada para evitar quinas
    const ys = smoothCircular(samples.map((s) => s[2]), 4, 2);
    for (let i = 0; i < n; i++) this.py[i] = ys[i];

    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      let dx = this.px[b] - this.px[a];
      let dz = this.pz[b] - this.pz[a];
      const len = Math.hypot(dx, dz);
      dx /= len;
      dz /= len;
      this.tx[i] = dx;
      this.tz[i] = dz;
      this.lx[i] = dz;
      this.lz[i] = -dx;
      this.slope[i] = (this.py[b] - this.py[a]) / len;
    }
    // curvatura assinada (positiva = curva para a esquerda)
    const curvRaw = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n;
      const b = (i + 2) % n;
      const cross = this.tz[a] * this.tx[b] - this.tx[a] * this.tz[b];
      curvRaw[i] = Math.asin(Math.max(-1, Math.min(1, cross))) / (4 * step);
    }
    const curv = smoothCircular(curvRaw, 3, 2);
    const gainRaw = samples.map((s) => s[3]);
    const bankRaw = new Array(n);
    for (let i = 0; i < n; i++) {
      this.curv[i] = curv[i];
      // gain do ponto escala a inclinacao e o limite (chicanes ficam mais planas)
      const g = gainRaw[i];
      const lim = config.maxBank * Math.min(1, g);
      const b = -config.bankGain * g * curv[i];
      bankRaw[i] = Math.max(-lim, Math.min(lim, b));
    }
    const bank = smoothCircular(bankRaw, 8, 3);
    for (let i = 0; i < n; i++) this.bank[i] = bank[i];

    // Eleva a pista onde a inclinacao deixaria a borda baixa abaixo do terreno.
    // Dilatacao (max) seguida de media com o mesmo raio garante lift >= necessario.
    const outer = this.halfWidth + config.wallThickness;
    const need = new Array(n);
    for (let i = 0; i < n; i++) need[i] = Math.max(0, outer * Math.abs(Math.tan(bank[i])) + 0.03 - this.py[i]);
    const R = 20;
    const dil = new Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let k = -R; k <= R; k++) m = Math.max(m, need[(i + k + n) % n]);
      dil[i] = m;
    }
    const lift = smoothCircular(dil, R, 1);
    for (let i = 0; i < n; i++) this.py[i] += lift[i];

    // rampas dos saltos (somadas depois da suavizacao para manter o lip abrupto)
    this.jumps = (config.jumps || []).map((j) => ({ ...j, gapEnd: j.lipS + j.gap }));
    for (const j of this.jumps) {
      const s0 = j.lipS - j.rampLength;
      for (let i = 0; i < n; i++) {
        const si = i * step;
        if (si >= s0 && si <= j.lipS) {
          const t = (si - s0) / j.rampLength;
          this.py[i] += j.rampHeight * t * t;
        }
      }
      const li = Math.min(n - 1, Math.floor(j.lipS / step));
      j.lipY = this.py[li];
      j.landY = this.py[Math.min(n - 1, Math.ceil(j.gapEnd / step))];
    }
    this.dirt = config.dirt || [];
    this.grassRoad = config.grass || [];
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const len = Math.hypot(this.px[b] - this.px[a], this.pz[b] - this.pz[a]);
      this.slope[i] = (this.py[b] - this.py[a]) / len;
    }

    this._buildGrid();
  }

  _buildGrid() {
    this.grid = new Map();
    const r = this.halfWidth + GRID_MARGIN;
    for (let i = 0; i < this.count; i++) {
      const j = (i + 1) % this.count;
      const minX = Math.min(this.px[i], this.px[j]) - r;
      const maxX = Math.max(this.px[i], this.px[j]) + r;
      const minZ = Math.min(this.pz[i], this.pz[j]) - r;
      const maxZ = Math.max(this.pz[i], this.pz[j]) + r;
      for (let cx = Math.floor(minX / GRID_CELL); cx <= Math.floor(maxX / GRID_CELL); cx++) {
        for (let cz = Math.floor(minZ / GRID_CELL); cz <= Math.floor(maxZ / GRID_CELL); cz++) {
          const key = cx * 100003 + cz;
          let list = this.grid.get(key);
          if (!list) this.grid.set(key, (list = []));
          list.push(i);
        }
      }
    }
  }

  // Indice e parametro do ponto mais proximo da linha central.
  // Retorna null se estiver longe da pista.
  project(x, z, out = {}) {
    const key = Math.floor(x / GRID_CELL) * 100003 + Math.floor(z / GRID_CELL);
    const list = this.grid.get(key);
    if (!list) return null;
    let best = Infinity;
    let bi = -1;
    let bt = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const j = (i + 1) % this.count;
      const ax = this.px[i];
      const az = this.pz[i];
      const ex = this.px[j] - ax;
      const ez = this.pz[j] - az;
      let t = ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (ax + ex * t);
      const dz = z - (az + ez * t);
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bi = i;
        bt = t;
      }
    }
    const i = bi;
    const j = (i + 1) % this.count;
    const t = bt;
    const cx = this.px[i] + (this.px[j] - this.px[i]) * t;
    const cz = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    let lx = this.lx[i] + (this.lx[j] - this.lx[i]) * t;
    let lz = this.lz[i] + (this.lz[j] - this.lz[i]) * t;
    const ll = Math.hypot(lx, lz);
    lx /= ll;
    lz /= ll;
    out.index = i;
    out.t = t;
    out.s = (i + t) * this.step;
    out.u = (x - cx) * lx + (z - cz) * lz;
    out.cy = this.py[i] + (this.py[j] - this.py[i]) * t;
    out.bank = this.bank[i] + (this.bank[j] - this.bank[i]) * t;
    out.slope = this.slope[i] + (this.slope[j] - this.slope[i]) * t;
    out.lx = lx;
    out.lz = lz;
    out.tx = -lz; // tangente = left x up... (tx, tz) = (-lz, lx)
    out.tz = lx;
    return out;
  }

  // Consulta de chao: altura, normal e material na posicao (x, z).
  // material: 'road' | 'dirt' | 'grass'
  ground(x, z, out = {}) {
    const p = this.project(x, z, (out._p ||= {}));
    const hw = this.halfWidth;
    const outer = hw + this.config.wallThickness;
    if (!p) {
      out.y = TERRAIN_Y;
      out.nx = 0; out.ny = 1; out.nz = 0;
      out.material = 'grass';
      out.u = Infinity;
      out.s = 0;
      return out;
    }
    const tb = Math.tan(p.bank);
    out.u = p.u;
    out.s = p.s;
    const au = Math.abs(p.u);
    if (this.inGap(p.s)) {
      // vao do salto: so o terreno la embaixo
      out.y = TERRAIN_Y;
      out.nx = 0; out.ny = 1; out.nz = 0;
      out.material = 'grass';
      return out;
    }
    if (au <= outer) {
      out.y = p.cy + p.u * tb;
      // normal = cross(dir_lateral, dir_longitudinal)
      const ex = p.lx, ey = tb, ez = p.lz; // lateral (esquerda)
      const dx = p.tx, dy = p.slope, dz = p.tz; // longitudinal
      let nx = dy * ez - dz * ey;
      let ny = dz * ex - dx * ez;
      let nz = dx * ey - dy * ex;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const nl = Math.hypot(nx, ny, nz);
      out.nx = nx / nl; out.ny = ny / nl; out.nz = nz / nl;
      out.material = this.isDirt(p.s) ? 'dirt' : this.isGrass(p.s) ? 'grass' : 'road';
      return out;
    }
    const sign = p.u > 0 ? 1 : -1;
    const edgeY = p.cy + sign * outer * tb;
    const excess = au - outer;
    const slopeY = edgeY - excess * EMBANKMENT_SLOPE;
    if (slopeY > TERRAIN_Y) {
      out.y = slopeY;
      // normal do talude: sobe em direcao a pista
      let nx = sign * p.lx * EMBANKMENT_SLOPE;
      let nz = sign * p.lz * EMBANKMENT_SLOPE;
      const nl = Math.hypot(nx, 1, nz);
      out.nx = nx / nl; out.ny = 1 / nl; out.nz = nz / nl;
    } else {
      out.y = TERRAIN_Y;
      out.nx = 0; out.ny = 1; out.nz = 0;
    }
    out.material = 'grass';
    return out;
  }

  inGap(s) {
    for (let k = 0; k < this.jumps.length; k++) {
      const j = this.jumps[k];
      if (s > j.lipS && s < j.gapEnd) return j;
    }
    return null;
  }

  isGrass(s) {
    for (let k = 0; k < this.grassRoad.length; k++) {
      if (s >= this.grassRoad[k].from && s <= this.grassRoad[k].to) return true;
    }
    return false;
  }

  isDirt(s) {
    for (let k = 0; k < this.dirt.length; k++) {
      if (s >= this.dirt[k].from && s <= this.dirt[k].to) return true;
    }
    return false;
  }

  // Ponto/orientacao na distancia s ao longo da pista (para spawn/visual).
  frameAt(s, u = 0) {
    const L = this.length;
    s = ((s % L) + L) % L;
    const f = s / this.step;
    const i = Math.floor(f) % this.count;
    const j = (i + 1) % this.count;
    const t = f - Math.floor(f);
    const lerp = (arr) => arr[i] + (arr[j] - arr[i]) * t;
    let lx = lerp(this.lx);
    let lz = lerp(this.lz);
    const ll = Math.hypot(lx, lz);
    lx /= ll; lz /= ll;
    const bank = lerp(this.bank);
    const cx = lerp(this.px) + lx * u;
    const cz = lerp(this.pz) + lz * u;
    const cy = lerp(this.py) + u * Math.tan(bank);
    return {
      x: cx, y: cy, z: cz,
      tx: -lz, tz: lx, // tangente
      lx, lz, bank,
      slope: lerp(this.slope),
      heading: Math.atan2(-lz, lx), // angulo de yaw (rotacao em y) para olhar ao longo da tangente
    };
  }

  // Distancia horizontal ate a borda externa do muro (negativa = dentro da pista).
  // Util para posicionar cenario sem invadir a pista.
  distanceFromRoad(x, z) {
    const p = this.project(x, z, {});
    if (!p) return Infinity;
    return Math.abs(p.u) - (this.halfWidth + this.config.wallThickness);
  }
}

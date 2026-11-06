// Fisica do carro "Stadium" (monoposto do TrackMania Nations Forever).
//
// Estrutura do CSceneVehicleCar::ComputeForcesModel6 (0x007C3E80), como
// reconstruida no TMNF-C (github.com/adonis-singh/TMNF-C) e no
// TMNationsDecomp (github.com/rockenrooster/TMNationsDecomp,
// core/src/gameplay/vehicle.cpp). Os valores de tuning sao os do tuning
// original do Stadium "20juin2006" usados no TMNationsDecomp
// (tests/vehicle_simulation_test.cpp). O que nao vem do jogo esta marcado.
//
// Como o carro funciona no Model 6:
//  * passo fixo de 100 Hz;
//  * forca lateral por roda aplicada no CENTRO de massa: -0.5*sideFriction1*v
//    no eixo do pneu, limitada por maxSideFriction(km/h). Passou do limite, a
//    roda fica "slipping" e no passo seguinte o limite cai para
//    maxSideFrictionSliding (35%) e, freando, mais ainda (x0.2);
//  * o giro (yaw) e um torque separado por eixo: amortecimento lateral
//    (steerGroundTorque) + torque de direcao steerDriveTorque(km/h);
//  * (aqui o freio so freia: sem drift, o freio nao solta as rodas);
//  * transferencia de peso via "inertial torque" (m6InertialTorqueModulation).
//
// Convencao local: +X = esquerda, +Y = cima, +Z = frente. Massa 1, entao
// forcas sao aceleracoes em m/s^2. Gravidade do Stadium = 10 * gravityCoef.
import { Curve } from './curve.js';

export const PHYSICS_DT = 0.01; // 100 Hz, igual ao TMNF
const KMH = 3.6;

// Layout das rodas (deve bater com src/scene/carModel.js CAR_WHEELS)
export const WHEELS = [
  { x: 0.92, y: -0.18, z: 1.62, radius: 0.38, steer: true },
  { x: -0.92, y: -0.18, z: 1.62, radius: 0.38, steer: true },
  { x: 0.92, y: -0.18, z: -1.28, radius: 0.38, steer: false },
  { x: -0.92, y: -0.18, z: -1.28, radius: 0.38, steer: false },
];

// Inercia do jogo: inertiaMass 5, meia-diagonal (0.5, 0.5, 1.0):
// invI = 12/5 / (soma dos quadrados das outras dimensoes)
function inertiaFromBox(mass, hx, hy, hz) {
  const w = 2 * hx, h = 2 * hy, d = 2 * hz;
  const s = 12 / mass;
  return [(h * h + d * d) / s, (w * w + d * d) / s, (w * w + h * h) / s];
}

export const TUNING = {
  // ---- tuning original "20juin2006" ----
  gravity: 30, // 10 * gravityCoef(3)
  gravityAir: 25, // 10 * gravityCoefAir(2.5)
  // inercia do jogo [2.08, 2.08, 0.83] com um extra de peso (nao vem do
  // jogo): o carro demora mais para comecar e parar de girar
  inertia: inertiaFromBox(5, 0.5, 0.5, 1.0).map((v, i) => v * [1.15, 1.3, 1.2][i]),
  angularSpeedClamp: 100,
  angularSpeedYImpulseScale: 0.55,

  // curva do jogo ate 100 km/h; acima disso (nao vem do jogo) a forca cai ate
  // zero em 550 km/h, que vira a velocidade maxima no plano (dificil de chegar)
  accelFromSpeed: new Curve([[-1000, 1], [-102, 2], [-80, 6], [-35, 12], [0, 16], [101, 11], [150, 8], [200, 5], [250, 3.4], [300, 2.4], [350, 1.75], [400, 1.25], [450, 0.9], [500, 0.6], [530, 0.35], [545, 0.15], [550, 0]]),
  reverseAccelFromSpeed: new Curve([[-150, 0.1], [-100, 1.5], [-50, 8], [0, 30]]),
  brakeMaxDynamic: 30,
  groundSlowDownCoef: 0.3, // desaceleracao (m/s^2) sem acelerador nem freio
  maxSpeed: 550 / KMH, // limite de 550 km/h (no jogo: 1000 km/h)
  overSpeedDrag: 8, // m/s^2 por m/s acima do limite (descidas, turbo)
  reverseMaxSpeed: 138.61111,

  steerRadiusMin: 2,
  steerRadiusCoef: 0.85, // angulo da roda = asin(1 / (2 + 0.85*|vz|))
  steerSpeed: 20, // suavizacao da direcao (unidades por segundo)
  steerLowSpeed: 30, // m/s: abaixo disso o torque de direcao cai (seno)
  steerGroundTorque: 0.08,
  steerGroundTorqueSlippingCoef: 1.0,
  // torque de direcao: jogo [0 16, 100 8.5, 200 5.5, 300 4.25, 500 3.75].
  // Aqui mais alto em velocidade para curvas mais fechadas (nao vem do jogo)
  steerDriveTorqueFromSpeed: new Curve([
    [-100, 7], [0, 16], [50, 11], [100, 10.4], [150, 10], [220, 8.4], [300, 7.2], [400, 5.9], [500, 5.3], [600, 5.0],
  ]),
  steerSlowDownFromSpeed: new Curve([[-50, 1], [0, 0], [300, 0]]),
  steerSlowDownCoef: 0.5,

  sideFriction1: 40,
  // jogo: 80 parado caindo para 55 a 500 km/h. Aqui sobe com a velocidade,
  // como o downforce de um F1 (nao vem do jogo): mais tracao nas curvas rapidas
  maxSideFrictionFromSpeed: new Curve([[0, 80], [100, 84], [200, 92], [300, 102], [400, 110], [500, 115], [600, 118]]),
  // jogo: 0.35. O pneu escorregando ainda segura 75% (pico suave, tipo Pacejka)
  maxSideFrictionSliding: 0.75,
  maxSideFrictionBlendCoef: 0.018,
  // fracao do amortecimento de giro mantida quando o eixo satura (jogo: 0.018)
  yawOverflowBlend: 0.018,
  // ---- tracao (nao vem do jogo) ----
  // controle de estabilidade: se o angulo de deriva passar deste limite
  // (cresce um pouco com a direcao), um torque alinha o carro com a
  // velocidade. Escorregar e possivel, rodar/drift nao.
  slipAngleMax: 0.06,
  slipAngleMaxPerSteer: 0.08,
  slipAngleRestore: 150,
  looseSteerLoss: 0.6, // na terra/grama o torque de direcao cai junto com a aderencia
  downforceCoef: 0.0006, // m/s^2 por (m/s)^2: +23 m/s^2 a 500 km/h (so no chao)
  // circulo de atrito: frear forte tira parte da aderencia lateral
  brakeLateralGripLoss: 0.2,
  slipEnterTime: 0.08, // s para a roda ficar totalmente "solta"
  slipRecoverTime: 0.18, // s para recuperar a aderencia no asfalto
  slipRecoverTimeLoose: 0.45, // na terra/grama a aderencia volta devagar
  slideDragKeep: 0.5, // parte do atrito lateral que freia o carro ao escorregar

  // jogo: 0.05; um pouco mais para a carroceria mostrar o peso
  inertialTorqueModulationX: 0.08,
  inertialTorqueModulationZ: 0.07,
  rollForceLimit: 45, // m/s^2 de forca lateral considerados na rolagem
  rolloverLateralFromSpeedRatio: new Curve([[0, 0], [1, 0.8], [10, 1], [20, 1], [30, 1]]),

  linearFluidFrictionCoef: 0.03, // arrasto no ar
  angularFluidFrictionCoef1: 0.4,
  angularFluidFrictionCoef2: 0.2,

  bodyFrictionCoef: 0.3,
  bodyRestCoef: 0.5,

  // ---- freio: forca = (base + scale*vz) * freio, limitada (nao solta as rodas) ----
  brakeBase: 18,
  brakeSpeedScale: 0.25,
  forwardBrakeLimit: 30,

  // ---- nao vem do jogo (a suspensao aqui e mola/raycast) ----
  suspTop: 0.15, // ponto de fixacao acima do cubo em repouso
  suspRest: 0.25, // extensao livre
  suspStiffness: 75, // com g=30: compressao estatica ~0.1 m
  suspDamping: 4.5,
  bumpStart: 0.21,
  bumpStiffness: 1500,
  // aderencia pela carga na roda (modulationFromWheelCompression do jogo,
  // remapeada para a compressao desta suspensao)
  gripFromCompression: new Curve([[0, 0.55], [0.03, 0.7], [0.06, 0.95], [0.08, 1]]),
  axleHalfSpan: 1.494, // metade do entre-eixos fisico do jogo
  steeringSlewRate: 20,
  keyboardSteerRate: 8.5, // teclado: direcao chega ao fim em ~0.12 s (peso)
  gasRiseRate: 6, // acelerador sobe em ~0.17 s (inercia do motor)
  // angulo VISUAL das rodas (o jogo usa 30 graus parado e 10 a 100 km/h;
  // aqui um pouco maior para a roda ser bem visivel)
  visualSteerDegFromSpeed: new Curve([[0, 28], [80, 19], [160, 14], [250, 11], [350, 9.5], [600, 8]]),
  reverseSpeedThreshold: 10 / KMH,
  turboAccel: 16,
  turboDuration: 1.2,
  // muro: sem quique e escorregadio -> o carro desliza rente a ele (como no
  // TM) em vez de ser jogado para tras; a batida gira pouco o carro
  wallRestitution: 0.0,
  wallFriction: 0.03,
  wallAngularScale: 0.05,
  // depois de encostar no muro o carro e alinhado com a direcao da velocidade
  // (rente ao muro), para uma batida leve nao estragar a volta
  wallAlignTime: 0.4,
  wallAlignGain: 70,
  wallAlignDamping: 9,
  groundRestitution: 0.1,
};

export const MATERIALS = {
  road: { lateralGrip: 1.0, accel: 1.0, brake: 1.0 },
  // grama (como no Stadium): o carro escorrega muito, acelera e freia pouco
  grass: { lateralGrip: 0.3, accel: 0.68, brake: 0.45 },
  // terra/barro: pouca aderencia lateral, mas tracao boa -> derrapa com o acelerador
  dirt: { lateralGrip: 0.45, accel: 0.92, brake: 0.75 },
};

const WALL_EXTRA_HEIGHT = 50; // barreira invisivel acima do muro

// Pontos de colisao do chassi (local)
const BODY_POINTS = [
  [0, -0.32, 2.52], [0.95, -0.47, 2.45], [-0.95, -0.47, 2.45],
  [0.6, -0.4, 0.9], [-0.6, -0.4, 0.9], [0.62, -0.4, -0.6], [-0.62, -0.4, -0.6],
  [0.5, -0.33, -1.8], [-0.5, -0.33, -1.8],
  [0.6, 0.58, -2.05], [-0.6, 0.58, -2.05], [0, 0.56, -0.45], [0, 0.37, 0.3],
  [0.45, 0.15, 0.2], [-0.45, 0.15, 0.2],
  // laterais das rodas (para muros)
  [1.12, -0.18, 1.62], [-1.12, -0.18, 1.62], [1.13, -0.18, -1.28], [-1.13, -0.18, -1.28],
  [1.0, -0.2, 1.95], [-1.0, -0.2, 1.95], [1.05, -0.2, -1.6], [-1.05, -0.2, -1.6],
];

// ---------- mini biblioteca de vetores/quaternions ----------
function quatToMat(q, m) {
  const { x, y, z, w } = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  // colunas = eixos locais em coordenadas do mundo
  m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy + wz); m[2] = 2 * (xz - wy); // eixo X
  m[3] = 2 * (xy - wz); m[4] = 1 - 2 * (xx + zz); m[5] = 2 * (yz + wx); // eixo Y
  m[6] = 2 * (xz + wy); m[7] = 2 * (yz - wx); m[8] = 1 - 2 * (xx + yy); // eixo Z
}
// mundo = R * local
function toWorld(m, v, out) {
  const x = v[0], y = v[1], z = v[2];
  out[0] = m[0] * x + m[3] * y + m[6] * z;
  out[1] = m[1] * x + m[4] * y + m[7] * z;
  out[2] = m[2] * x + m[5] * y + m[8] * z;
  return out;
}
// local = R^T * mundo
function toLocal(m, v, out) {
  const x = v[0], y = v[1], z = v[2];
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[3] * x + m[4] * y + m[5] * z;
  out[2] = m[6] * x + m[7] * y + m[8] * z;
  return out;
}
function cross(a, b, out) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

export class StadiumCar {
  constructor(track, tuning = TUNING) {
    this.track = track;
    this.tun = tuning;
    this.R = new Float64Array(9);
    this.pos = [0, 0, 0];
    this.quat = { x: 0, y: 0, z: 0, w: 1 };
    this.vel = [0, 0, 0];
    this.angVel = [0, 0, 0];
    this.force = [0, 0, 0];
    this.torque = [0, 0, 0];
    this.priorForce = [0, 0, 0]; // forca local do passo anterior (inertial torque)
    this.input = { gas: 0, brake: 0, steer: 0, analogSteer: false };
    this.steerValue = 0;
    this.gasValue = 0;
    this.steerAngle = 0;
    this.visualSteerAngle = 0;
    this.drifting = false; // sem drift (mantido por compatibilidade)
    this.velYawRate = 0;
    this.wallAlignLeft = 0;
    this.reverseMode = false;
    this.sliding = false;
    this.anySliding = false;
    this.braking = false;
    this.tick = 0;
    this.turboTime = 0;
    this.grounded = false;
    this.wallHit = 0;
    this.localVel = [0, 0, 0];
    this.localAng = [0, 0, 0];
    this.wheels = WHEELS.map((w) => ({
      ...w,
      contact: false,
      compression: 0,
      prevCompression: 0,
      normal: [0, 1, 0],
      material: MATERIALS.road,
      materialName: 'road',
      isSliding: false,
      slipAmount: 0,
      spin: 0,
      spinSpeed: 0,
      offset: 0, // deslocamento visual da suspensao
      contactPoint: [0, 0, 0],
    }));
    this._g = {};
    this._tmp = { a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0], d: [0, 0, 0], e: [0, 0, 0] };
  }

  reset(x, y, z, heading) {
    this.pos[0] = x; this.pos[1] = y; this.pos[2] = z;
    this.quat.x = 0; this.quat.y = Math.sin(heading / 2); this.quat.z = 0; this.quat.w = Math.cos(heading / 2);
    this.vel.fill(0);
    this.angVel.fill(0);
    this.priorForce.fill(0);
    this.steerValue = 0;
    this.gasValue = 0;
    this.steerAngle = 0;
    this.visualSteerAngle = 0;
    this.reverseMode = false;
    this.drifting = false;
    this.velYawRate = 0;
    this.wallAlignLeft = 0;
    this._velHeading = undefined;
    this.turboTime = 0;
    for (const w of this.wheels) {
      w.isSliding = false; w.slipAmount = 0; w.contact = false; w.compression = 0; w.prevCompression = 0; w.spinSpeed = 0;
    }
    quatToMat(this.quat, this.R);
  }

  get speed() {
    return Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
  }
  get forwardSpeed() {
    return this.localVel[2];
  }

  activateTurbo() {
    this.turboTime = this.tun.turboDuration;
  }

  // --- acumuladores (coordenadas do mundo) ---
  addLocalCentralForce(f) {
    const w = toWorld(this.R, f, this._tmp.e);
    this.force[0] += w[0]; this.force[1] += w[1]; this.force[2] += w[2];
  }
  addLocalTorque(t) {
    const w = toWorld(this.R, t, this._tmp.e);
    this.torque[0] += w[0]; this.torque[1] += w[1]; this.torque[2] += w[2];
  }
  addLocalForceAt(f, p) {
    const fw = toWorld(this.R, f, this._tmp.d);
    const pw = toWorld(this.R, p, this._tmp.c);
    this.force[0] += fw[0]; this.force[1] += fw[1]; this.force[2] += fw[2];
    const t = cross(pw, fw, this._tmp.e);
    this.torque[0] += t[0]; this.torque[1] += t[1]; this.torque[2] += t[2];
  }

  // Iinv_world * v
  applyInvInertia(v, out) {
    const l = toLocal(this.R, v, this._tmp.a);
    const I = this.tun.inertia;
    l[0] /= I[0]; l[1] /= I[1]; l[2] /= I[2];
    return toWorld(this.R, l, out);
  }

  step(dt = PHYSICS_DT) {
    const T = this.tun;
    const R = this.R;
    this.tick++;
    quatToMat(this.quat, R);
    this.torque.fill(0);

    // ---- direcao suavizada (steerSpeed) ----
    const inp = this.input;
    if (inp.analogSteer) {
      this.steerValue = inp.steer;
    } else {
      const maxD = Math.min(T.steerSpeed, T.keyboardSteerRate) * dt;
      this.steerValue += clamp(inp.steer - this.steerValue, -maxD, maxD);
    }

    // acelerador com inercia (o freio continua imediato)
    if (inp.gas > this.gasValue) this.gasValue = Math.min(inp.gas, this.gasValue + T.gasRiseRate * dt);
    else this.gasValue = inp.gas;

    const lv = toLocal(R, this.vel, this.localVel);
    const la = toLocal(R, this.angVel, this.localAng);
    // giro da direcao da velocidade (rad/s, positivo = para a esquerda)
    const velHeading = Math.atan2(this.vel[0], this.vel[2]);
    if (Math.hypot(this.vel[0], this.vel[2]) > 3 && this._velHeading !== undefined) {
      let d = velHeading - this._velHeading;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      this.velYawRate += (clamp(d / dt, -4, 4) - this.velYawRate) * 0.5;
    } else {
      this.velYawRate = 0;
    }
    this._velHeading = velHeading;

    // ---- suspensao (antes, para saber quem esta no chao) ----
    const wasGrounded = this.grounded;
    this.force[0] = 0; this.force[1] = -(wasGrounded ? T.gravity : T.gravityAir); this.force[2] = 0;
    this.updateWheels(dt);
    const grounded = this.wheels.some((w) => w.contact);
    this.grounded = grounded;

    // angulo fisico das rodas: asin(1 / (steerRadiusMin + coef*|vz|))
    const radius = T.steerRadiusMin + T.steerRadiusCoef * Math.abs(lv[2]);
    this.steerAngle = Math.asin(clamp(1 / radius, -1, 1)) * this.steerValue;
    this.visualSteerAngle = ((T.visualSteerDegFromSpeed.at(Math.abs(lv[2]) * KMH) * Math.PI) / 180) * this.steerValue;

    this.computeForces(dt, lv, la, grounded);

    // ---- integracao (Euler semi-implicito) ----
    const v = this.vel;
    v[0] += this.force[0] * dt; v[1] += this.force[1] * dt; v[2] += this.force[2] * dt;
    const aa = this.applyInvInertia(this.torque, this._tmp.b);
    const w = this.angVel;
    w[0] += aa[0] * dt; w[1] += aa[1] * dt; w[2] += aa[2] * dt;
    const wl = Math.hypot(w[0], w[1], w[2]);
    if (wl > T.angularSpeedClamp) {
      const s = T.angularSpeedClamp / wl;
      w[0] *= s; w[1] *= s; w[2] *= s;
    }
    // forca local deste passo, usada no "inertial torque" do proximo
    toLocal(R, this.force, this.priorForce);

    // velocidade maxima absoluta (1000 km/h)
    const sp = Math.hypot(v[0], v[1], v[2]);
    const vmax = T.maxSpeed * 1.03;
    if (sp > vmax) {
      v[0] *= vmax / sp; v[1] *= vmax / sp; v[2] *= vmax / sp;
    }

    this.resolveContacts(dt);

    this.pos[0] += v[0] * dt; this.pos[1] += v[1] * dt; this.pos[2] += v[2] * dt;
    this.integrateRotation(dt);

    // rotacao visual das rodas
    for (const wh of this.wheels) {
      const target = lv[2] / wh.radius;
      if (wh.contact) wh.spinSpeed = target;
      else wh.spinSpeed += (inp.gas > 0.1 && !this.reverseMode ? 60 : 0) * dt - wh.spinSpeed * 0.8 * dt;
      if (wh.contact && this.anySliding && inp.gas > 0.1 && !wh.steer) wh.spinSpeed = target * 1.15 + 6;
      wh.spin += wh.spinSpeed * dt;
    }
    if (this.turboTime > 0) this.turboTime = Math.max(0, this.turboTime - dt);
  }

  updateWheels(dt) {
    const T = this.tun;
    const R = this.R;
    const up = [R[3], R[4], R[5]];
    const A = this._tmp.a;
    const g = this._g;
    for (const wh of this.wheels) {
      wh.prevCompression = wh.compression;
      toWorld(R, [wh.x, wh.y + T.suspTop, wh.z], A);
      const ax = A[0] + this.pos[0], ay = A[1] + this.pos[1], az = A[2] + this.pos[2];
      this.track.ground(ax, az, g);
      const n = [g.nx, g.ny, g.nz];
      const denom = dot(up, n);
      let contact = false;
      let comp = 0;
      if (denom > 0.3) {
        const dist = ((ay - g.y) * n[1]) / denom;
        comp = T.suspRest - (dist - wh.radius);
        if (comp > 0 && dist > -1.0) contact = true;
      }
      wh.contact = contact;
      wh.normal = n;
      wh.materialName = g.material;
      wh.material = MATERIALS[g.material] || MATERIALS.road;
      if (!contact) {
        wh.compression = 0;
        wh.isSliding = false;
        wh.offset += (T.suspTop - T.suspRest - wh.offset) * Math.min(1, dt * 12);
        continue;
      }
      wh.compression = comp;
      const compVel = wh.prevCompression === 0 ? 0 : (comp - wh.prevCompression) / dt;
      let f = T.suspStiffness * comp + T.suspDamping * compVel;
      if (comp > T.bumpStart) f += T.bumpStiffness * (comp - T.bumpStart);
      if (f < 0) f = 0;
      this.addLocalForceAt([0, f, 0], [wh.x, wh.y, wh.z]);
      wh.offset = T.suspTop - (T.suspRest - comp);
      const reach = T.suspRest - comp + wh.radius;
      wh.contactPoint[0] = ax - up[0] * reach;
      wh.contactPoint[1] = ay - up[1] * reach;
      wh.contactPoint[2] = az - up[2] * reach;
    }
  }

  computeForces(dt, lv, la, grounded) {
    const T = this.tun;
    const inp = this.input;
    const kmh = lv[2] * KMH;

    if (!grounded) {
      // no ar: arrasto linear e amortecimento angular (fluid friction)
      const f = this._tmp.b;
      f[0] = -lv[0] * T.linearFluidFrictionCoef;
      f[1] = -lv[1] * T.linearFluidFrictionCoef;
      f[2] = -lv[2] * T.linearFluidFrictionCoef;
      this.addLocalCentralForce(f);
      const len = Math.hypot(la[0], la[1], la[2]);
      if (len >= 1e-5) {
        const mag = T.angularFluidFrictionCoef1 * len + T.angularFluidFrictionCoef2 * len * len;
        this.addLocalTorque([(-la[0] / len) * mag, (-la[1] / len) * mag, (-la[2] / len) * mag]);
      }
      for (const wh of this.wheels) { wh.isSliding = false; wh.slipAmount = 0; }
      this.anySliding = false;
      this.sliding = false;
      this.braking = false;
      return;
    }

    // material medio das rodas no chao
    let mAccel = 0, mBrake = 0, mGrip = 0, nc = 0;
    for (const wh of this.wheels) {
      if (!wh.contact) continue;
      nc++;
      mAccel += wh.material.accel;
      mBrake += wh.material.brake;
      mGrip += wh.material.lateralGrip;
    }
    mAccel /= nc; mBrake /= nc; mGrip /= nc;

    // ---- modo re (latch do jogo, +0x5C4) ----
    if (inp.brake > 0.1 && lv[2] < T.reverseSpeedThreshold && Math.abs(lv[0]) < 2) this.reverseMode = true;
    if (inp.gas > 0.1 && (lv[2] > 0 || Math.abs(lv[0]) > 2)) this.reverseMode = false;
    if (inp.gas < 0.1 && inp.brake < 0.1) this.reverseMode = lv[2] <= -2;
    if (lv[2] > 0 && this.turboTime > 0) this.reverseMode = false;

    // ---- forca longitudinal ----
    let accel = 0;
    let brake = 0;
    if (!this.reverseMode) {
      if (this.gasValue > 0) accel += this.gasValue * Math.max(0, T.accelFromSpeed.at(kmh)) * mAccel;
      if (inp.brake > 0.1 && lv[2] > 0.1) {
        // freio simples (como um ABS): so desacelera, nao solta as rodas
        brake = (T.brakeBase + T.brakeSpeedScale * lv[2]) * inp.brake;
        brake = Math.min(brake, T.forwardBrakeLimit, T.brakeMaxDynamic) * mBrake;
      }
    } else {
      // re: o freio acelera para tras; o acelerador freia
      if (inp.brake > 0) accel -= inp.brake * Math.max(0, T.reverseAccelFromSpeed.at(Math.min(0, kmh))) * mAccel;
      if (inp.gas > 0.1 && lv[2] < -0.1) brake = T.brakeMaxDynamic * inp.gas * mBrake;
    }
    if (inp.gas <= 0.001 && inp.brake <= 0.001) {
      // groundSlowDownCoef: desaceleracao suave ao soltar tudo
      brake = Math.max(brake, T.groundSlowDownCoef);
    }
    if (this.turboTime > 0 && lv[2] > -1) accel += T.turboAccel * (this.turboTime / T.turboDuration) * mAccel;
    // nao inverter o sentido dentro de um passo
    const vz = lv[2];
    if (brake * dt > Math.abs(vz)) brake = Math.abs(vz) / dt;
    let net = accel - Math.sign(vz) * brake;
    // steer slowdown (no tuning do Stadium so atua em marcha re)
    net -= (vz < 0 ? -1 : 1) * T.steerSlowDownCoef * Math.abs(this.steerValue) * T.steerSlowDownFromSpeed.at(kmh);
    if (vz > T.maxSpeed) net = Math.min(net, 0) - T.overSpeedDrag * (vz - T.maxSpeed);
    if (vz < -T.reverseMaxSpeed) net = Math.max(net, 0);
    this.addLocalCentralForce([0, 0, net]);
    this.braking = brake > 1 && inp.brake > 0.1 && !this.reverseMode;

    // ---- downforce (nao vem do jogo): empurra o carro contra a pista com v^2,
    // mantem as rodas carregadas nas curvas rapidas ----
    this.addLocalCentralForce([0, -T.downforceCoef * lv[2] * lv[2], 0]);

    // ---- inertial torque: transferencia de peso pela forca anterior ----
    // a forca lateral usada na rolagem e limitada: com a tracao alta (curvas de
    // 13g+) a rolagem do jogo ficaria enorme e o carro tombaria no muro
    const pf = this._pfRoll || (this._pfRoll = [0, 0, 0]);
    pf[0] = clamp(this.priorForce[0], -T.rollForceLimit, T.rollForceLimit);
    pf[1] = this.priorForce[1];
    pf[2] = this.priorForce[2];
    if (dot(pf, pf) >= 1e-4) {
      let tx = 0, tz = 0;
      const lever = this._tmp.c;
      for (const wh of this.wheels) {
        if (!wh.contact) continue;
        lever[0] = wh.x;
        lever[1] = wh.y - (T.suspRest - wh.compression) - wh.radius;
        lever[2] = wh.z;
        const t = cross(lever, pf, this._tmp.d);
        tx += t[0];
        tz += t[2];
      }
      this.addLocalTorque([tx * T.inertialTorqueModulationX, 0, tz * T.inertialTorqueModulationZ]);
    }

    // ---- forca lateral dos pneus (no centro de massa) ----
    const maxSide = T.maxSideFrictionFromSpeed.at(kmh);
    const hSpeed = Math.hypot(lv[0], lv[2]);
    const halfSide = 0.5 * T.sideFriction1;
    const cs = Math.cos(this.steerAngle);
    const sn = Math.sin(this.steerAngle);
    const nl = this._tmp.c;
    const f = this._tmp.b;
    let modelSliding = false;
    // circulo de atrito: parte da aderencia vai para o freio
    const brakeGrip = 1 - T.brakeLateralGripLoss * Math.min(1, brake / Math.max(1, T.brakeMaxDynamic));
    for (const wh of this.wheels) {
      if (!wh.contact) continue;
      // eixo lateral do pneu a partir da normal de contato: (n.y, -n.x, 0)
      toLocal(this.R, wh.normal, nl);
      let ax = nl[1], ay = -nl[0], az = 0;
      const al = Math.hypot(ax, ay);
      if (al < 1e-6) { ax = 1; ay = 0; } else { ax /= al; ay /= al; }
      if (wh.steer) {
        // positivo = direita (frente gira para -X)
        ax *= cs; ay *= cs; az = sn;
      }
      const raw = -halfSide * (lv[0] * ax + lv[1] * ay + lv[2] * az);
      // No jogo o estado "slipping" e binario (limite cai para 35% no passo
      // seguinte). Aqui ele vira um valor continuo que entra rapido e sai em
      // ~slipRecoverTime, e o pneu escorregando ainda segura bem (como o pico
      // suave da curva de Pacejka): escorrega e volta, sem trancos.
      const sa = wh.slipAmount;
      const slipFactor = lerp(1, T.maxSideFrictionSliding, sa);
      const cap = wh.material.lateralGrip * maxSide * slipFactor * brakeGrip * T.gripFromCompression.at(wh.compression);
      let side = raw;
      if (Math.abs(raw) <= cap) {
        wh.isSliding = false;
        wh.slipAmount = Math.max(0, sa - dt / (wh.material.lateralGrip < 0.9 ? T.slipRecoverTimeLoose : T.slipRecoverTime));
      } else {
        wh.isSliding = true;
        wh.slipAmount = Math.min(1, sa + dt / T.slipEnterTime);
        side = lerp(Math.sign(raw) * cap, raw, T.maxSideFrictionBlendCoef);
        modelSliding = true;
      }
      f[0] = side * ax; f[1] = side * ay; f[2] = side * az;
      if (wh.isSliding && hSpeed > 5) {
        // parte do atrito lateral que freia o carro ao escorregar (nao vem do jogo)
        const along = (f[0] * lv[0] + f[2] * lv[2]) / hSpeed;
        if (along < 0) {
          const k = ((1 - T.slideDragKeep) * along) / hSpeed;
          f[0] -= k * lv[0];
          f[2] -= k * lv[2];
        }
      }
      this.addLocalCentralForce(f);
    }

    // ---- torque de giro por eixo (amortecimento + direcao) ----
    const speedLen = Math.hypot(lv[0], lv[1], lv[2]);
    const lowSpeed = speedLen < 0.7 ? 0 : speedLen < T.steerLowSpeed ? Math.sin((speedLen / T.steerLowSpeed) * Math.PI * 0.5) : 1;
    // em terra/grama o pneu nao tem aderencia para girar o carro tao forte (nao vem do jogo)
    const drive = T.steerDriveTorqueFromSpeed.at(kmh) * lerp(1, mGrip, T.looseSteerLoss);
    const yawCap = maxSide * mGrip;
    const dir = this.reverseMode ? -1 : 1;
    let yawTorque = 0;
    let yawOverflow = false;
    for (const wh of this.wheels) {
      const h = wh.steer ? T.axleHalfSpan : -T.axleHalfSpan;
      const raw = -halfSide * (lv[0] + la[1] * h);
      let limited = raw;
      if (Math.abs(raw) > yawCap) {
        limited = lerp(Math.sign(raw) * yawCap, raw, T.yawOverflowBlend);
        yawOverflow = true;
      }
      let yawForce = T.steerGroundTorque * limited;
      if (wh.steer) {
        yawForce -= dir * lowSpeed * this.steerValue * drive * (wh.isSliding ? T.steerGroundTorqueSlippingCoef : 1);
      }
      yawTorque += yawForce * h;
    }
    const steerAbs = Math.abs(this.steerValue);
    const beta = lv[2] > 1 ? Math.atan2(lv[0], lv[2]) : 0;
    // alinhamento apos encostar no muro
    if (this.wallAlignLeft > 0) {
      this.wallAlignLeft -= dt;
      if (lv[2] > 3) {
        // alinha o carro com a velocidade e segura o giro (nao usa o giro da
        // velocidade aqui: o desvio no muro o faria parecer enorme)
        yawTorque += T.wallAlignGain * beta - T.wallAlignDamping * la[1];
      }
    }
    // controle de estabilidade (nao vem do jogo): no Model 6 puro, com o eixo
    // saturado o carro roda de repente. Aqui, passando do limite de deriva, um
    // torque alinha o carro com a velocidade: ele escorrega um pouco, mas nao
    // entra em drift nem roda.
    if (lv[2] > 8) {
      const over = Math.abs(beta) - (T.slipAngleMax + T.slipAngleMaxPerSteer * steerAbs);
      if (over > 0) yawTorque += Math.sign(beta) * T.slipAngleRestore * over;
    }
    // rollover: torque de rolagem pela razao velocidade lateral/frontal
    const ratio = (lv[0] * lv[0]) / (Math.abs(lv[2]) + 1);
    const roll = T.rolloverLateralFromSpeedRatio.at(ratio * KMH) * (lv[0] <= 0 ? 1 : -1);
    this.addLocalTorque([0, yawTorque, roll]);

    // marcas/fumaca/som de pneu: so quando o carro escorrega de verdade
    this.anySliding = modelSliding || (yawOverflow && Math.abs(beta) > 0.05);
    this.sliding = this.anySliding;
  }

  integrateRotation(dt) {
    const q = this.quat;
    const [wx, wy, wz] = this.angVel;
    const dx = 0.5 * (wx * q.w + wy * q.z - wz * q.y);
    const dy = 0.5 * (wy * q.w + wz * q.x - wx * q.z);
    const dz = 0.5 * (wz * q.w + wx * q.y - wy * q.x);
    const dw = 0.5 * (-wx * q.x - wy * q.y - wz * q.z);
    q.x += dx * dt; q.y += dy * dt; q.z += dz * dt; q.w += dw * dt;
    const l = Math.hypot(q.x, q.y, q.z, q.w);
    q.x /= l; q.y /= l; q.z /= l; q.w /= l;
    quatToMat(q, this.R);
  }

  // Colisao do chassi com o chao e com os muros (impulsos sequenciais).
  // O impulso angular e escalado por angularSpeedYImpulseScale, como no jogo.
  resolveContacts() {
    const T = this.tun;
    const track = this.track;
    const R = this.R;
    const hw = track.halfWidth;
    const thick = track.config.wallThickness;
    const wallH = track.config.wallHeight;
    const center = track.project(this.pos[0], this.pos[2], (this._pc ||= {}));
    const centerInside = !center || Math.abs(center.u) < hw + thick * 0.5;
    const contacts = [];
    const g = this._g;
    const p = [0, 0, 0];
    const pp = {};
    let maxWall = 0;
    for (const bp of BODY_POINTS) {
      toWorld(R, bp, p);
      const wx = p[0] + this.pos[0], wy = p[1] + this.pos[1], wz = p[2] + this.pos[2];
      track.ground(wx, wz, g);
      if (wy < g.y) {
        const pen = (g.y - wy) * g.ny;
        contacts.push({ r: [p[0], p[1], p[2]], n: [g.nx, g.ny, g.nz], pen, e: T.groundRestitution, mu: T.bodyFrictionCoef, wall: false, ang: T.angularSpeedYImpulseScale });
      }
      const pr = track.project(wx, wz, pp);
      // no vao dos saltos o muro continua invisivel (nao da para escapar da pista voando)
      if (!pr) continue;
      const au = Math.abs(pr.u);
      if (au < hw - 0.05 || au > hw + thick + 0.8) continue;
      const sign = pr.u > 0 ? 1 : -1;
      const edgeY = pr.cy + sign * hw * Math.tan(pr.bank);
      if (wy > edgeY + wallH + WALL_EXTRA_HEIGHT || wy < edgeY - 2.5) continue;
      let pen, nx, nz;
      if (centerInside) {
        pen = au - hw;
        nx = -sign * pr.lx; nz = -sign * pr.lz;
      } else {
        pen = hw + thick - au;
        nx = sign * pr.lx; nz = sign * pr.lz;
      }
      if (pen <= 0) continue;
      // impulso do muro na altura do centro de massa (gira em yaw, nao capota)
      contacts.push({ r: [p[0], 0, p[2]], n: [nx, 0, nz], pen, e: T.wallRestitution, mu: T.wallFriction, wall: true, ang: T.wallAngularScale });
    }
    if (contacts.length === 0) {
      this.wallHit = 0;
      return;
    }
    const v = this.vel;
    const w = this.angVel;
    const rn = [0, 0, 0];
    const tmp = [0, 0, 0];
    const vp = [0, 0, 0];
    const t = [0, 0, 0];
    for (let iter = 0; iter < 4; iter++) {
      for (const c of contacts) {
        const { r, n } = c;
        const angScale = c.ang;
        cross(w, r, tmp);
        vp[0] = v[0] + tmp[0]; vp[1] = v[1] + tmp[1]; vp[2] = v[2] + tmp[2];
        const vn = dot(vp, n);
        if (vn >= 0) continue;
        cross(r, n, rn);
        this.applyInvInertia(rn, tmp);
        cross(tmp, r, tmp);
        const kn = 1 + dot(n, tmp) * angScale;
        const e = iter === 0 ? c.e : 0;
        const j = (-(1 + e) * vn) / kn;
        if (c.wall && iter === 0) maxWall = Math.max(maxWall, -vn);
        t[0] = vp[0] - vn * n[0]; t[1] = vp[1] - vn * n[1]; t[2] = vp[2] - vn * n[2];
        const vt = Math.hypot(t[0], t[1], t[2]);
        const J = [n[0] * j, n[1] * j, n[2] * j];
        if (vt > 1e-4) {
          t[0] /= vt; t[1] /= vt; t[2] /= vt;
          cross(r, t, rn);
          this.applyInvInertia(rn, tmp);
          cross(tmp, r, tmp);
          const kt = 1 + dot(t, tmp) * angScale;
          const jt = Math.min(vt / kt, c.mu * j);
          J[0] -= t[0] * jt; J[1] -= t[1] * jt; J[2] -= t[2] * jt;
        }
        v[0] += J[0]; v[1] += J[1]; v[2] += J[2];
        cross(r, J, rn);
        this.applyInvInertia(rn, tmp);
        w[0] += tmp[0] * angScale; w[1] += tmp[1] * angScale; w[2] += tmp[2] * angScale;
      }
    }
    let cx = 0, cy = 0, cz = 0;
    for (const c of contacts) {
      const k = Math.min(c.pen, 0.5) * 0.6;
      cx = Math.abs(c.n[0] * k) > Math.abs(cx) ? c.n[0] * k : cx;
      cy = Math.abs(c.n[1] * k) > Math.abs(cy) ? c.n[1] * k : cy;
      cz = Math.abs(c.n[2] * k) > Math.abs(cz) ? c.n[2] * k : cz;
    }
    this.pos[0] += cx; this.pos[1] += cy; this.pos[2] += cz;
    this.wallHit = maxWall;
    if (maxWall > 0.3) {
      this.wallAlignLeft = T.wallAlignTime;
    }
  }
}

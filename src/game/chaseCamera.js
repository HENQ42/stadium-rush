// Camera de perseguicao no estilo TrackMania (camera 1 / camera 2 / cockpit).
import * as THREE from 'three';

const MODES = [
  { name: 'Perseguicao', dist: 6.2, height: 2.1, look: 1.0, fov: 70 },
  { name: 'Distante', dist: 9.5, height: 3.4, look: 1.2, fov: 66 },
  { name: 'Cockpit', cockpit: true, fov: 80 },
];

export class ChaseCamera {
  constructor(camera, track) {
    this.camera = camera;
    this.track = track;
    this.mode = 0;
    this.pos = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, 1); // direcao suavizada atras do carro
    this.target = new THREE.Vector3();
    this.shake = 0;
    this._v = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._g = {};
    this.initialized = false;
  }

  get modeName() {
    return MODES[this.mode].name;
  }

  nextMode() {
    this.mode = (this.mode + 1) % MODES.length;
    this.initialized = false;
  }

  snap() {
    this.initialized = false;
  }

  // carPos: THREE.Vector3, carQuat: THREE.Quaternion, car: StadiumCar
  update(dt, carPos, carQuat, car) {
    const m = MODES[this.mode];
    const cam = this.camera;
    const fwd = this._f.set(0, 0, 1).applyQuaternion(carQuat);
    const up = this._up.set(0, 1, 0).applyQuaternion(carQuat);
    const speed = car.speed;
    const kmh = speed * 3.6;

    if (car.wallHit > 4) this.shake = Math.min(0.5, this.shake + car.wallHit * 0.02);
    this.shake *= Math.exp(-6 * dt);

    let fovTarget = m.fov + Math.min(18, kmh * 0.045) + (car.turboTime > 0 ? 6 : 0);

    if (m.cockpit) {
      const eye = this._v.set(0, 0.45, -0.05).applyQuaternion(carQuat).add(carPos);
      cam.position.copy(eye);
      this.target.copy(fwd).multiplyScalar(20).add(eye);
      cam.up.copy(up);
      cam.lookAt(this.target);
    } else {
      // direcao: mistura da orientacao do carro com a direcao da velocidade (horizontal)
      const flatF = this._v.set(fwd.x, 0, fwd.z);
      if (flatF.lengthSq() < 1e-4) flatF.set(0, 0, 1);
      flatF.normalize();
      const vel = car.vel;
      const hs = Math.hypot(vel[0], vel[2]);
      if (hs > 8 && car.localVel[2] > 0) {
        const k = Math.min(0.35, (hs - 8) / 60);
        flatF.multiplyScalar(1 - k).add(new THREE.Vector3(vel[0] / hs, 0, vel[2] / hs).multiplyScalar(k)).normalize();
      }
      if (!this.initialized) {
        this.dir.copy(flatF);
      } else {
        const rate = car.grounded ? 7 : 2.5;
        this.dir.lerp(flatF, 1 - Math.exp(-rate * dt)).normalize();
      }
      const dist = m.dist + Math.min(1.6, kmh * 0.004);
      const desired = new THREE.Vector3()
        .copy(carPos)
        .addScaledVector(this.dir, -dist)
        .add(new THREE.Vector3(0, m.height, 0));
      if (!this.initialized) {
        this.pos.copy(desired);
      } else {
        // segue rapido no plano e mais suave na vertical
        const kxz = 1 - Math.exp(-14 * dt);
        const ky = 1 - Math.exp(-6 * dt);
        this.pos.x += (desired.x - this.pos.x) * kxz;
        this.pos.z += (desired.z - this.pos.z) * kxz;
        this.pos.y += (desired.y - this.pos.y) * ky;
      }
      // nao entrar no chao
      const g = this.track.ground(this.pos.x, this.pos.z, this._g);
      if (this.pos.y < g.y + 0.8) this.pos.y = g.y + 0.8;
      // com o carro dentro da pista, manter a camera entre os muros
      const pc = this.track.project(carPos.x, carPos.z, (this._pc ||= {}));
      const pk = this.track.project(this.pos.x, this.pos.z, (this._pk ||= {}));
      const lim = this.track.halfWidth - 0.4;
      if (pc && pk && Math.abs(pc.u) < this.track.halfWidth && Math.abs(pk.u) > lim) {
        const excess = Math.abs(pk.u) - lim;
        const sg = pk.u > 0 ? 1 : -1;
        this.pos.x -= sg * pk.lx * excess;
        this.pos.z -= sg * pk.lz * excess;
        const g2 = this.track.ground(this.pos.x, this.pos.z, this._g);
        if (this.pos.y < g2.y + 0.8) this.pos.y = g2.y + 0.8;
      }
      cam.position.copy(this.pos);
      if (this.shake > 0.001) {
        cam.position.x += (Math.random() - 0.5) * this.shake;
        cam.position.y += (Math.random() - 0.5) * this.shake;
      }
      this.target.copy(carPos).add(new THREE.Vector3(0, m.look, 0)).addScaledVector(this.dir, 2.5);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.target);
    }
    this.initialized = true;
    cam.fov += (fovTarget - cam.fov) * (1 - Math.exp(-4 * dt));
    cam.updateProjectionMatrix();
  }
}

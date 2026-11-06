// Logica da corrida: contagem regressiva, checkpoints, voltas, tempos,
// respawn, combustivel (multiplayer) e recorde salvo no navegador.
const STORAGE_PREFIX = 'jogo-carro-web.best.v1';

export class Race {
  // opts:
  //   laps    numero de voltas (0 = livre, voltas infinitas)
  //   fuel    segundos de combustivel por checkpoint (0 = desligado)
  //   gridS   posicao de largada (m ao longo da pista); padrao 6 m antes da linha
  //   gridU   deslocamento lateral da largada (m, positivo = esquerda)
  //   records salvar recorde da volta no navegador
  constructor(track, car, opts = {}) {
    this.track = track;
    this.car = car;
    this.cpS = track.config.checkpointFractions.map((f) => f * track.length);
    this.startS = track.config.startDistance;
    this.laps = opts.laps || 0;
    this.fuelMax = opts.fuel || 0;
    this.gridS = opts.gridS ?? this.startS - 6;
    this.gridU = opts.gridU ?? 0;
    this.records = opts.records ?? true;
    // a pista classica mantem a chave antiga para nao perder o recorde salvo
    this.storageKey = !track.id || track.id === 'classic' ? STORAGE_PREFIX : `${STORAGE_PREFIX}.${track.id}`;
    this.best = this.records ? this.loadBest() : null; // { time, splits: [] } ou null
    this.listeners = {};
    this.restart();
  }

  on(event, fn) {
    (this.listeners[event] ||= []).push(fn);
  }
  emit(event, data) {
    for (const fn of this.listeners[event] || []) fn(data);
  }

  loadBest() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  saveBest() {
    if (!this.records) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.best));
    } catch {
      /* armazenamento indisponivel */
    }
  }

  // Reinicia tudo a partir da largada. countdown em segundos (multiplayer
  // usa o tempo restante ate o "GO" combinado pelo master).
  restart(countdown = 3) {
    this.state = 'countdown';
    this.countdown = countdown;
    this.lastBeep = 4;
    this.lapTime = 0;
    this.raceTime = 0;
    this.lap = 1;
    this.lapTimes = [];
    this.bestLap = null;
    this.splits = [];
    this.nextCp = 0;
    this.lastLap = null;
    this.fuel = this.fuelMax;
    this.respawnS = this.gridS;
    this.spawnAt(this.gridS, this.gridU);
    this.emit('restart');
  }

  spawnAt(s, u = 0) {
    const L = this.track.length;
    s = ((s % L) + L) % L;
    const f = this.track.frameAt(s, u);
    this.car.reset(f.x, f.y + 0.6, f.z, f.heading);
    this.prevS = s;
    this.emit('spawn');
  }

  // Volta ao ultimo checkpoint (tecla Enter). O tempo continua correndo, como no TM.
  // O combustivel nao e reabastecido.
  respawn() {
    if (this.state !== 'racing') return;
    this.spawnAt(this.respawnS, this.respawnS === this.gridS ? this.gridU : 0);
  }

  get controlsLocked() {
    return this.state !== 'racing';
  }

  get finished() {
    return this.state === 'finished' || this.state === 'dnf';
  }

  // Distancia percorrida na corrida (m), usada para ordenar os pilotos.
  get progress() {
    const L = this.track.length;
    if (this.state === 'finished') return this.laps * L + 1e6;
    let d = (((this.prevS - this.startS) % L) + L) % L;
    if (this.nextCp === 0 && d > L / 2) d -= L; // ainda antes da linha
    return (this.lap - 1) * L + d;
  }

  // Termina a corrida sem completar (sem combustivel ou encerrada pelo master).
  disqualify(reason = 'fuel') {
    if (this.state !== 'racing' && this.state !== 'countdown') return;
    this.state = 'dnf';
    this.dnfReason = reason;
    this.emit('dnf', { reason });
  }

  // Chamado a cada passo de fisica (100 Hz).
  step(dt) {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const sec = Math.ceil(this.countdown);
      if (sec < this.lastBeep && sec > 0 && sec <= 3) {
        this.lastBeep = sec;
        this.emit('countdown', sec);
      }
      if (this.countdown <= 0) {
        this.state = 'racing';
        this.lapTime = 0;
        this.raceTime = 0;
        this.fuel = this.fuelMax;
        this.emit('go');
      }
      return;
    }
    if (this.state !== 'racing') return;
    this.lapTime += dt;
    this.raceTime += dt;
    if (this.fuelMax > 0) {
      this.fuel -= dt;
      if (this.fuel <= 0) {
        this.fuel = 0;
        this.disqualify('fuel');
        return;
      }
    }

    const p = this.track.project(this.car.pos[0], this.car.pos[2], (this._p ||= {}));
    if (!p) return;
    const L = this.track.length;
    let ds = p.s - this.prevS;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;
    const from = this.prevS;
    this.prevS = p.s;
    if (ds <= 0 || ds > 30 || Math.abs(p.u) > this.track.halfWidth + 2) return;

    const crossed = (target) => {
      // cruzou "target" indo de from ate from+ds (com volta no fim da pista)
      let d = target - from;
      if (d < 0) d += L;
      return d > 0 && d <= ds;
    };

    if (this.nextCp < this.cpS.length && crossed(this.cpS[this.nextCp])) {
      const t = this.lapTime;
      this.splits.push(t);
      const bestSplit = this.best?.splits?.[this.nextCp];
      this.respawnS = this.cpS[this.nextCp];
      this.nextCp++;
      this.fuel = this.fuelMax;
      this.emit('checkpoint', { index: this.nextCp, lap: this.lap, time: t, raceTime: this.raceTime, diff: bestSplit != null ? t - bestSplit : null });
    } else if (this.nextCp === this.cpS.length && crossed(this.startS)) {
      const t = this.lapTime;
      const diff = this.best ? t - this.best.time : null;
      const isBest = !this.best || t < this.best.time;
      if (isBest) {
        this.best = { time: t, splits: this.splits.slice() };
        this.saveBest();
      }
      this.lastLap = t;
      this.lapTimes.push(t);
      if (this.bestLap == null || t < this.bestLap) this.bestLap = t;
      this.fuel = this.fuelMax;
      this.emit('lap', { lap: this.lap, time: t, diff, isBest, raceTime: this.raceTime });
      if (this.laps && this.lap >= this.laps) {
        this.state = 'finished';
        this.emit('finish', { totalTime: this.raceTime, lapTimes: this.lapTimes.slice(), bestLap: this.bestLap });
        return;
      }
      this.lap++;
      this.lapTime = 0;
      this.splits = [];
      this.nextCp = 0;
      this.respawnS = this.startS;
    }
  }

  resetBest() {
    this.best = null;
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      /* ignore */
    }
  }
}

export function formatTime(t) {
  if (t == null || !isFinite(t)) return '--:--.---';
  const neg = t < 0;
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 1000) % 1000);
  return `${neg ? '-' : ''}${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function formatDiff(d) {
  if (d == null) return '';
  const sign = d < 0 ? '-' : '+';
  const a = Math.abs(d);
  const s = Math.floor(a);
  const ms = Math.floor((a * 1000) % 1000);
  return `${sign}${s}.${String(ms).padStart(3, '0')}`;
}

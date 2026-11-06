// Audio do carro Stadium, 100% sintetizado com WebAudio (sem arquivos).
//
//  * motor: 3 osciladores desafinados (2 dente-de-serra + 1 quadrada na oitava)
//    -> ganho de "drive" -> waveshaper (saturacao) -> passa-baixa ressonante.
//    O tom segue um RPM falso calculado a partir da velocidade frontal, com
//    6 marchas simuladas ate ~370 km/h (o RPM cai na troca, como no TM);
//  * chiado de pneu: ruido branco em passa-banda (~1.5-2.6 kHz) com oscilacao
//    lenta da frequencia + um tom de "squeal" com vibrato;
//  * ronco de grama: ruido em passa-baixa quando as rodas estao na grama;
//  * vento: ruido em passa-baixa cuja frequencia e volume sobem com a velocidade;
//  * turbo: "whoosh" de ruido com passa-banda varrendo enquanto turboTime > 0;
//  * eventos curtos: batida no muro, aterrissagem e bipes de interface.
//
// O AudioContext so e criado em start() (politica de autoplay dos navegadores),
// entao o modulo pode ser importado no Node: antes de start() todos os metodos
// sao no-op.

const KMH = 3.6;
const MASTER_VOLUME = 0.42;

// marchas: velocidade (km/h) em que cada marcha atinge RPM_MAX
const GEAR_TOP_KMH = [65, 115, 170, 235, 310, 390, 470, 555];
const RPM_IDLE = 2600;
const RPM_MAX = 11500;
const RPM_UPSHIFT = 11000;
const RPM_DOWNSHIFT = 9400; // RPM que a marcha de baixo teria
const REVERSE_TOP_KMH = 75;
const SHIFT_DIP_TIME = 0.09; // corte de aceleracao durante a troca (s)
const SHIFT_COOLDOWN = 0.25;

// constantes de tempo do setTargetAtTime (s)
const TC_PITCH = 0.025;
const TC_GAIN = 0.05;
const TC_FILTER = 0.04;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function makeSaturationCurve(k, n = 1024) {
  const curve = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

export class EngineAudio {
  constructor() {
    this.ctx = null;
    this._muted = false;
    this._nodes = null;
    // estado da simulacao (independente do contexto)
    this._gear = 0;
    this._rpm = RPM_IDLE;
    this._shiftDip = 0;
    this._shiftCooldown = 0;
    this._airTime = 0;
    this._wasGrounded = true;
    this._wallCooldown = 0;
    this._initialized = false; // primeiro update apos start()
  }

  get muted() {
    return this._muted;
  }

  // Chamar no primeiro gesto do usuario (keydown/click/touch). Idempotente.
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
    if (!AC) return;
    let ctx;
    try {
      ctx = new AC();
    } catch {
      return;
    }
    this.ctx = ctx;
    this._buildGraph();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  _buildGraph() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const n = {};
    this._nodes = n;

    // ---- saida ----
    n.master = ctx.createGain();
    n.master.gain.value = this._muted ? 0 : MASTER_VOLUME;
    n.comp = ctx.createDynamicsCompressor();
    n.comp.threshold.value = -10;
    n.comp.knee.value = 8;
    n.comp.ratio.value = 4;
    n.comp.attack.value = 0.005;
    n.comp.release.value = 0.15;
    n.master.connect(n.comp);
    n.comp.connect(ctx.destination);

    // buffer de ruido branco compartilhado (2 s)
    const len = Math.floor(ctx.sampleRate * 2);
    n.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = n.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    n.sources = []; // fontes continuas (para dispose)
    const loopNoise = (offset) => {
      const s = ctx.createBufferSource();
      s.buffer = n.noise;
      s.loop = true;
      s.start(now, offset);
      n.sources.push(s);
      return s;
    };
    const osc = (type, freq) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.start(now);
      n.sources.push(o);
      return o;
    };
    const gain = (v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };

    // ---- motor ----
    const f0 = this._rpmToFreq(RPM_IDLE);
    n.engA = osc('sawtooth', f0);
    n.engB = osc('sawtooth', f0);
    n.engB.detune.value = 7;
    // variacao lenta de afinacao: evita o tom constante que cansa o ouvido
    n.engWobble = osc('sine', 0.37);
    const wobbleDepth = gain(5);
    n.engWobble.connect(wobbleDepth);
    wobbleDepth.connect(n.engA.detune);
    wobbleDepth.connect(n.engB.detune);
    // sub-oitava em seno: da corpo ao som sem o chiado agudo de uma quadrada
    n.engC = osc('sine', f0 * 0.5);
    n.engDrive = gain(0.5); // ganho antes da saturacao
    const ga = gain(0.42), gb = gain(0.3), gc = gain(0.55);
    n.engA.connect(ga); n.engB.connect(gb); n.engC.connect(gc);
    ga.connect(n.engDrive); gb.connect(n.engDrive); gc.connect(n.engDrive);
    n.engShaper = ctx.createWaveShaper();
    n.engShaper.curve = makeSaturationCurve(1.5);
    n.engShaper.oversample = '2x';
    n.engFilter = ctx.createBiquadFilter();
    n.engFilter.type = 'lowpass';
    n.engFilter.frequency.value = 700;
    n.engFilter.Q.value = 0.9;
    n.engGain = gain(0);
    n.engDrive.connect(n.engShaper);
    n.engShaper.connect(n.engFilter);
    n.engFilter.connect(n.engGain);
    n.engGain.connect(n.master);

    // ---- chiado de pneu ----
    n.screechSrc = loopNoise(0.13);
    n.screechBand = ctx.createBiquadFilter();
    n.screechBand.type = 'bandpass';
    n.screechBand.frequency.value = 1800;
    n.screechBand.Q.value = 2.2;
    n.screechLfo = osc('sine', 5.5); // oscilacao da frequencia
    const lfoDepth = gain(220);
    n.screechLfo.connect(lfoDepth);
    lfoDepth.connect(n.screechBand.frequency);
    n.squeal = osc('triangle', 1250); // componente tonal do chiado
    n.squealLfo = osc('sine', 8);
    const squealDepth = gain(45);
    n.squealLfo.connect(squealDepth);
    squealDepth.connect(n.squeal.frequency);
    const squealGain = gain(0.035);
    n.squeal.connect(squealGain);
    n.screechGain = gain(0);
    n.screechSrc.connect(n.screechBand);
    n.screechBand.connect(n.screechGain);
    squealGain.connect(n.screechGain);
    n.screechGain.connect(n.master);

    // ---- ronco de grama/terra ----
    n.grassSrc = loopNoise(0.71);
    n.grassFilter = ctx.createBiquadFilter();
    n.grassFilter.type = 'lowpass';
    n.grassFilter.frequency.value = 350;
    n.grassFilter.Q.value = 1.5;
    n.grassGain = gain(0);
    n.grassSrc.connect(n.grassFilter);
    n.grassFilter.connect(n.grassGain);
    n.grassGain.connect(n.master);

    // ---- vento ----
    n.windSrc = loopNoise(1.07);
    n.windFilter = ctx.createBiquadFilter();
    n.windFilter.type = 'lowpass';
    n.windFilter.frequency.value = 300;
    n.windFilter.Q.value = 0.7;
    n.windGain = gain(0);
    n.windSrc.connect(n.windFilter);
    n.windFilter.connect(n.windGain);
    n.windGain.connect(n.master);

    // ---- turbo ----
    n.turboSrc = loopNoise(1.49);
    n.turboFilter = ctx.createBiquadFilter();
    n.turboFilter.type = 'bandpass';
    n.turboFilter.frequency.value = 600;
    n.turboFilter.Q.value = 2.5;
    n.turboGain = gain(0);
    n.turboSrc.connect(n.turboFilter);
    n.turboFilter.connect(n.turboGain);
    n.turboGain.connect(n.master);

    // ---- bipes de interface ----
    n.ui = gain(0.6);
    n.ui.connect(n.master);
  }

  _rpmToFreq(rpm) {
    // fundamental "audivel" do motor (escolhida para soar agudo como no Stadium)
    return (rpm / 60) * 1.55;
  }

  // ---------------- atualizacao por quadro ----------------
  update(car, dt) {
    if (!this.ctx || !this._nodes || !car) return;
    dt = clamp(dt || 0, 0, 0.1);
    const n = this._nodes;
    const t = this.ctx.currentTime;
    const lv = car.localVel || [0, 0, 0];
    const inp = car.input || { gas: 0, brake: 0 };
    const reverse = !!car.reverseMode;
    const throttle = clamp01(reverse ? inp.brake : inp.gas);
    const grounded = !!car.grounded;
    const fwdKmh = Math.abs(lv[2]) * KMH;
    const v = car.vel || [0, 0, 0];
    const speed = Math.hypot(v[0], v[1], v[2]);

    if (!this._initialized) {
      this._initialized = true;
      this._wasGrounded = grounded;
      this._airTime = 0;
    }

    // ---- marchas e RPM ----
    this._shiftCooldown = Math.max(0, this._shiftCooldown - dt);
    this._shiftDip = Math.max(0, this._shiftDip - dt);
    let rpmTarget;
    if (reverse) {
      this._gear = 0;
      rpmTarget = (fwdKmh / REVERSE_TOP_KMH) * RPM_MAX * 0.85;
    } else {
      if (grounded && this._shiftCooldown <= 0) {
        const g = this._gear;
        if (g < GEAR_TOP_KMH.length - 1 && (fwdKmh / GEAR_TOP_KMH[g]) * RPM_MAX > RPM_UPSHIFT) {
          this._gear = g + 1;
          this._shiftCooldown = SHIFT_COOLDOWN;
          this._shiftDip = throttle > 0.1 ? SHIFT_DIP_TIME : 0;
        } else if (g > 0 && (fwdKmh / GEAR_TOP_KMH[g - 1]) * RPM_MAX < RPM_DOWNSHIFT) {
          this._gear = g - 1;
          this._shiftCooldown = SHIFT_COOLDOWN;
        }
      }
      rpmTarget = (fwdKmh / GEAR_TOP_KMH[this._gear]) * RPM_MAX;
    }
    // embreagem patinando na largada / giro livre no ar / patinagem na derrapagem
    rpmTarget = Math.max(rpmTarget, RPM_IDLE + throttle * 3800);
    if (!grounded) rpmTarget += throttle * 2500;
    else if (car.anySliding && throttle > 0.1) rpmTarget += 900 * throttle;
    if (car.turboTime > 0) rpmTarget += 400;
    rpmTarget = clamp(rpmTarget, RPM_IDLE, RPM_MAX);
    // inercia do motor: sobe um pouco mais devagar do que cai (troca = queda rapida)
    const k = rpmTarget > this._rpm ? 12 : this._shiftCooldown > 0.15 ? 28 : 16;
    this._rpm += (rpmTarget - this._rpm) * (1 - Math.exp(-k * dt));
    // pequena oscilacao no limitador
    let rpm = this._rpm;
    if (rpm > RPM_MAX - 150 && throttle > 0.5) rpm -= Math.random() * 180;

    const rpmN = clamp01((rpm - RPM_IDLE) / (RPM_MAX - RPM_IDLE));
    const g = throttle * (this._shiftDip > 0 ? 0.3 : 1);
    const f0 = this._rpmToFreq(rpm);
    n.engA.frequency.setTargetAtTime(f0, t, TC_PITCH);
    n.engB.frequency.setTargetAtTime(f0, t, TC_PITCH);
    n.engC.frequency.setTargetAtTime(f0 * 0.5, t, TC_PITCH);
    n.engDrive.gain.setTargetAtTime(0.5 + 0.8 * g, t, TC_GAIN);
    // filtro mais fechado e sem ressonancia: menos "zumbido" cansativo
    n.engFilter.frequency.setTargetAtTime(380 + 1700 * rpmN * (0.45 + 0.55 * g) + 450 * g, t, TC_FILTER);
    n.engFilter.Q.setTargetAtTime(0.8 + 0.9 * g, t, TC_FILTER);
    n.engGain.gain.setTargetAtTime(0.07 + 0.04 * rpmN + g * (0.1 + 0.05 * rpmN), t, TC_GAIN);

    // ---- pneus ----
    let sliding = 0, slidingRoad = 0, grassContact = 0;
    const wheels = car.wheels || [];
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      if (!w.contact) continue;
      const grass = w.materialName !== 'road'; // grama ou terra
      if (grass) grassContact++;
      if (w.isSliding) {
        sliding++;
        if (!grass) slidingRoad++;
      }
    }
    const speedF = clamp01((speed - 4) / 18);
    const slideAmt = (slidingRoad / 4) * speedF;
    n.screechGain.gain.setTargetAtTime(0.18 * Math.sqrt(slideAmt), t, TC_GAIN);
    n.screechBand.frequency.setTargetAtTime(1100 + Math.min(700, speed * 6), t, TC_FILTER);
    n.squeal.frequency.setTargetAtTime(1150 + Math.min(500, speed * 4), t, TC_FILTER);
    // na grama o deslizamento vira ronco de terra
    const grassAmt = (grassContact / 4) * clamp01(speed / 40) * (sliding > slidingRoad ? 1.3 : 1);
    n.grassGain.gain.setTargetAtTime(0.25 * grassAmt, t, TC_GAIN);
    n.grassFilter.frequency.setTargetAtTime(250 + Math.min(500, speed * 5), t, TC_FILTER);

    // ---- vento ----
    const windN = clamp01(speed / 110);
    n.windGain.gain.setTargetAtTime(0.16 * windN * windN, t, TC_GAIN * 2);
    n.windFilter.frequency.setTargetAtTime(200 + Math.min(3800, speed * 12), t, TC_FILTER * 2);

    // ---- turbo ----
    const turboDur = (car.tun && car.tun.turboDuration) || 1.2;
    if (car.turboTime > 0) {
      const tk = clamp01(car.turboTime / turboDur);
      n.turboGain.gain.setTargetAtTime(0.25 * Math.sqrt(tk), t, 0.03);
      n.turboFilter.frequency.setTargetAtTime(500 + (1 - tk) * 2200, t, 0.05);
    } else {
      n.turboGain.gain.setTargetAtTime(0, t, 0.12);
    }

    // ---- batida no muro ----
    this._wallCooldown = Math.max(0, this._wallCooldown - dt);
    if (car.wallHit > 3 && this._wallCooldown <= 0) {
      this._wallCooldown = 0.15;
      this._playImpact(clamp((car.wallHit - 3) / 22, 0.1, 1));
    }

    // ---- aterrissagem ----
    if (!grounded) {
      this._airTime += dt;
    } else {
      if (!this._wasGrounded && this._airTime > 0.3) {
        this._playLanding(clamp(this._airTime / 1.2, 0.25, 1));
      }
      this._airTime = 0;
    }
    this._wasGrounded = grounded;
  }

  // ---------------- eventos curtos ----------------
  _envelope(dest, t0, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.setTargetAtTime(0, t0 + attack, decay / 4);
    g.connect(dest);
    return g;
  }

  _oneShotNoise(t0, dur, filterType, freq, q, peak, attack, dest = this._nodes.master) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._nodes.noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this._envelope(dest, t0, peak, attack, dur);
    src.connect(f);
    f.connect(g);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + attack + dur * 1.5);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
    return f;
  }

  _oneShotTone(t0, type, f1, f2, glide, peak, attack, dur, dest = this._nodes.master) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f1, t0);
    if (f2 !== f1) o.frequency.exponentialRampToValueAtTime(f2, t0 + glide);
    const g = this._envelope(dest, t0, peak, attack, dur);
    o.connect(g);
    o.start(t0);
    o.stop(t0 + attack + dur * 1.5);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }

  _playImpact(s) {
    const t0 = this.ctx.currentTime;
    // crunch (ruido) + thump (seno caindo)
    this._oneShotNoise(t0, 0.18 + 0.15 * s, 'lowpass', 800 + 2500 * s, 1.2, 0.5 * s + 0.1, 0.003);
    this._oneShotTone(t0, 'sine', 110, 45, 0.15, 0.6 * s, 0.004, 0.2);
    if (s > 0.5) {
      // estalo metalico nas batidas fortes
      this._oneShotNoise(t0, 0.08, 'bandpass', 3200, 4, 0.25 * s, 0.002);
    }
  }

  _playLanding(s) {
    const t0 = this.ctx.currentTime;
    this._oneShotTone(t0, 'sine', 80, 38, 0.2, 0.55 * s, 0.006, 0.25);
    this._oneShotNoise(t0, 0.12, 'lowpass', 300, 1, 0.3 * s, 0.004);
  }

  _beep(t0, freq, dur, type = 'square', vol = 0.18) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.min(12000, freq * 6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
    g.gain.setValueAtTime(vol, t0 + Math.max(0.006, dur - 0.03));
    g.gain.setTargetAtTime(0, t0 + Math.max(0.006, dur - 0.03), 0.02);
    o.connect(f);
    f.connect(g);
    g.connect(this._nodes.ui);
    o.start(t0);
    o.stop(t0 + dur + 0.15);
    o.onended = () => { o.disconnect(); f.disconnect(); g.disconnect(); };
  }

  playCheckpoint() {
    if (!this.ctx || !this._nodes) return;
    const t0 = this.ctx.currentTime + 0.005;
    this._beep(t0, 1046.5, 0.09, 'square', 0.14);
    this._beep(t0 + 0.09, 1568, 0.16, 'square', 0.14);
    this._beep(t0 + 0.09, 3136, 0.16, 'sine', 0.05);
  }

  playFinish(isBestTime = false) {
    if (!this.ctx || !this._nodes) return;
    const t0 = this.ctx.currentTime + 0.005;
    if (isBestTime) {
      // arpejo ascendente mais longo e brilhante
      const notes = [1046.5, 1318.5, 1568, 2093, 2637];
      notes.forEach((f, i) => {
        this._beep(t0 + i * 0.075, f, i === notes.length - 1 ? 0.5 : 0.09, 'square', 0.13);
        this._beep(t0 + i * 0.075, f * 2, i === notes.length - 1 ? 0.5 : 0.09, 'sine', 0.04);
      });
    } else {
      const notes = [784, 1046.5, 1318.5];
      notes.forEach((f, i) => this._beep(t0 + i * 0.1, f, i === notes.length - 1 ? 0.35 : 0.1, 'square', 0.13));
    }
  }

  playCountdown(isGo = false) {
    if (!this.ctx || !this._nodes) return;
    const t0 = this.ctx.currentTime + 0.005;
    if (isGo) {
      this._beep(t0, 1318.5, 0.5, 'square', 0.16);
      this._beep(t0, 2637, 0.5, 'sine', 0.05);
    } else {
      this._beep(t0, 659.3, 0.16, 'square', 0.16);
    }
  }

  // ---------------- mudo / descarte ----------------
  setMuted(muted) {
    this._muted = !!muted;
    if (this.ctx && this._nodes) {
      this._nodes.master.gain.setTargetAtTime(this._muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.02);
    }
  }

  toggleMute() {
    this.setMuted(!this._muted);
    return this._muted;
  }

  dispose() {
    if (!this.ctx) return;
    const n = this._nodes;
    if (n) {
      for (const s of n.sources) {
        try { s.stop(); } catch { /* ja parado */ }
        try { s.disconnect(); } catch { /* ok */ }
      }
      try { n.master.disconnect(); n.comp.disconnect(); } catch { /* ok */ }
    }
    const ctx = this.ctx;
    this.ctx = null;
    this._nodes = null;
    this._initialized = false;
    ctx.close().catch(() => {});
  }
}

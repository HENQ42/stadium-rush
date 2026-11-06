// HUD em DOM: velocimetro, cronometro, checkpoints, contagem, minimapa, ajuda,
// e no multiplayer: combustivel, posicao, classificacao e espectador.
import { formatTime, formatDiff } from './race.js';

export class Hud {
  constructor(root, track) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-top">
        <div class="hud-lap"><span class="label">VOLTA</span> <span id="hud-lap">1</span></div>
        <div class="hud-timer" id="hud-timer">0:00.000</div>
        <div class="hud-cps" id="hud-cps"></div>
        <div class="hud-fuel" id="hud-fuel">
          <span class="label">COMBUSTIVEL</span>
          <div class="fuel-bar"><div id="hud-fuelbar"></div></div>
          <span class="fuel-sec" id="hud-fuelsec"></span>
        </div>
      </div>
      <div class="hud-pos" id="hud-pos"></div>
      <div class="hud-board" id="hud-board"></div>
      <div class="hud-spec" id="hud-spec"></div>
      <div class="hud-times">
        <div><span class="label">MELHOR</span> <span id="hud-best">--:--.---</span></div>
        <div><span class="label">ULTIMA</span> <span id="hud-last">--:--.---</span></div>
      </div>
      <div class="hud-split" id="hud-split"></div>
      <div class="hud-countdown" id="hud-countdown"></div>
      <div class="hud-speed">
        <div class="speed-value" id="hud-speed">0</div>
        <div class="speed-unit">KM/H</div>
        <div class="speed-bar"><div id="hud-speedbar"></div></div>
        <div class="hud-flags"><span id="hud-turbo">TURBO</span><span id="hud-rev">RE</span></div>
      </div>
      <canvas class="hud-map" id="hud-map" width="220" height="220"></canvas>
      <div class="hud-toast" id="hud-toast"></div>
      <div class="hud-help" id="hud-help">
        <b>Controles</b><br>
        ↑ / W &nbsp;acelerar<br>
        ↓ / S / Espaco &nbsp;freio / re<br>
        ← → / A D &nbsp;direcao<br>
        Enter &nbsp;voltar ao checkpoint<br>
        Delete / R &nbsp;reiniciar (solo)<br>
        C &nbsp;camera &nbsp;·&nbsp; M &nbsp;som &nbsp;·&nbsp; H &nbsp;ajuda &nbsp;·&nbsp; Esc &nbsp;menu<br>
        Assistindo: ← → troca o piloto<br>
        Gamepad: RT/LT gatilhos, analogico, Y respawn, Start reinicia
      </div>
    `;
    this.el = (id) => root.querySelector(`#${id}`);
    this.timer = this.el('hud-timer');
    this.speed = this.el('hud-speed');
    this.speedBar = this.el('hud-speedbar');
    this.lap = this.el('hud-lap');
    this.best = this.el('hud-best');
    this.last = this.el('hud-last');
    this.split = this.el('hud-split');
    this.countdownEl = this.el('hud-countdown');
    this.cps = this.el('hud-cps');
    this.turbo = this.el('hud-turbo');
    this.rev = this.el('hud-rev');
    this.help = this.el('hud-help');
    this.toastEl = this.el('hud-toast');
    this.fuelBox = this.el('hud-fuel');
    this.fuelBar = this.el('hud-fuelbar');
    this.fuelSec = this.el('hud-fuelsec');
    this.posEl = this.el('hud-pos');
    this.board = this.el('hud-board');
    this.spec = this.el('hud-spec');
    this.map = this.el('hud-map');
    this.mapCtx = this.map.getContext('2d');
    this.splitTimer = 0;
    this.toastTimer = 0;
    this.countdownTimer = 0;
    this.setTrack(track);
    this.setVisible(false);
  }

  setTrack(track) {
    this.track = track;
    this.prepareMap();
  }

  setVisible(v) {
    this.root.classList.toggle('hidden', !v);
  }

  prepareMap() {
    const t = this.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.count; i++) {
      minX = Math.min(minX, t.px[i]); maxX = Math.max(maxX, t.px[i]);
      minZ = Math.min(minZ, t.pz[i]); maxZ = Math.max(maxZ, t.pz[i]);
    }
    const W = this.map.width, H = this.map.height, pad = 16;
    const scale = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxZ - minZ));
    const ox = (W - (maxX - minX) * scale) / 2, oz = (H - (maxZ - minZ) * scale) / 2;
    // visto de cima com +Z para cima e +X para a esquerda (como a camera atras do carro)
    this.toMap = (x, z) => [W - (ox + (x - minX) * scale), H - (oz + (z - minZ) * scale)];
    const bg = document.createElement('canvas');
    bg.width = W; bg.height = H;
    const c = bg.getContext('2d');
    c.lineJoin = 'round';
    const path = () => {
      c.beginPath();
      for (let i = 0; i <= t.count; i++) {
        const [x, y] = this.toMap(t.px[i % t.count], t.pz[i % t.count]);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
    };
    path(); c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 9; c.stroke();
    path(); c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 4; c.stroke();
    const sf = t.frameAt(t.config.startDistance);
    const [sx, sy] = this.toMap(sf.x, sf.z);
    c.fillStyle = '#e63946';
    c.fillRect(sx - 5, sy - 2, 10, 4);
    this.mapBg = bg;
    this.cpS = t.config.checkpointFractions.map((f) => f * t.length);
  }

  showHelp(v) {
    this.help.classList.toggle('visible', v ?? !this.help.classList.contains('visible'));
  }

  toast(text, seconds = 1.5) {
    if (this.root.classList.contains('hidden')) return; // no menu/lobby o aviso ficaria preso
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    this.toastTimer = seconds;
  }

  showCountdown(text, cls = '') {
    this.countdownEl.textContent = text;
    this.countdownEl.className = `hud-countdown visible ${cls}`;
    this.countdownTimer = text === 'GO!' ? 0.9 : 1.2;
  }

  showSplit(time, diff, label) {
    const d = diff == null ? '' : `<span class="${diff <= 0 ? 'better' : 'worse'}">${formatDiff(diff)}</span>`;
    this.split.innerHTML = `<div class="split-label"></div><div class="split-time">${formatTime(time)}</div>${d}`;
    this.split.firstChild.textContent = label;
    this.split.classList.add('visible');
    this.splitTimer = 2.5;
  }

  // Classificacao ao vivo (multiplayer). rows: [{ name, css, info, self }]
  setBoard(rows) {
    const key = JSON.stringify(rows);
    if (key === this._boardKey) return;
    this._boardKey = key;
    this.board.replaceChildren();
    if (!rows || !rows.length) return;
    rows.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = `board-row${r.self ? ' self' : ''}${r.out ? ' out' : ''}`;
      const pos = document.createElement('span');
      pos.className = 'board-pos';
      pos.textContent = String(i + 1);
      const dot = document.createElement('span');
      dot.className = 'board-dot';
      dot.style.background = r.css;
      const name = document.createElement('span');
      name.className = 'board-name';
      name.textContent = r.name;
      const info = document.createElement('span');
      info.className = 'board-info';
      info.textContent = r.info;
      row.append(pos, dot, name, info);
      this.board.appendChild(row);
    });
  }

  setSpectating(text) {
    this.spec.textContent = text || '';
    this.spec.classList.toggle('visible', !!text);
  }

  // mp (opcional): { laps, timer, lap, nextCp, fuel, fuelMax, position, total,
  //                  others: [{x, z, css}], focus: {x, z, fx, fz}, lastLap, bestLap }
  update(dt, race, car, mp = null) {
    const kmh = Math.abs(car.localVel[2] * 3.6);
    this.speed.textContent = Math.round(kmh);
    this.speedBar.style.width = `${Math.min(100, (kmh / 400) * 100)}%`;
    const lap = mp ? mp.lap : race.lap;
    const nextCp = mp ? mp.nextCp : race.nextCp;
    if (mp) {
      this.timer.textContent = formatTime(mp.timer);
      this.lap.textContent = mp.laps ? `${Math.min(lap, mp.laps)}/${mp.laps}` : String(lap);
      this.best.textContent = formatTime(mp.bestLap);
      this.last.textContent = formatTime(mp.lastLap);
    } else {
      this.timer.textContent = formatTime(race.state === 'countdown' ? 0 : race.lapTime);
      this.lap.textContent = race.lap;
      this.best.textContent = formatTime(race.best?.time);
      this.last.textContent = formatTime(race.lastLap);
    }
    let cps = '';
    for (let i = 0; i < this.cpS.length; i++) cps += `<span class="${i < nextCp ? 'done' : ''}"></span>`;
    if (this.cps.dataset.v !== cps) { this.cps.innerHTML = cps; this.cps.dataset.v = cps; }
    this.turbo.classList.toggle('on', car.turboTime > 0);
    this.rev.classList.toggle('on', car.reverseMode);

    // combustivel
    const showFuel = !!(mp && mp.fuelMax > 0 && mp.fuel != null);
    this.fuelBox.classList.toggle('visible', showFuel);
    if (showFuel) {
      const k = Math.max(0, Math.min(1, mp.fuel / mp.fuelMax));
      this.fuelBar.style.width = `${(k * 100).toFixed(1)}%`;
      this.fuelSec.textContent = `${mp.fuel.toFixed(1)} s`;
      this.fuelBox.classList.toggle('low', mp.fuel < 5);
    }
    const pos = mp && mp.position ? `${mp.position}<small>/${mp.total}</small>` : '';
    if (this.posEl.dataset.v !== pos) {
      this.posEl.innerHTML = pos;
      this.posEl.dataset.v = pos;
    }

    if (this.splitTimer > 0 && (this.splitTimer -= dt) <= 0) this.split.classList.remove('visible');
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.classList.remove('visible');
    if (this.countdownTimer > 0 && (this.countdownTimer -= dt) <= 0) this.countdownEl.classList.remove('visible');

    // minimapa (30 Hz basta e poupa o canvas 2D em PCs fracos)
    this.mapAcc = (this.mapAcc || 0) + dt;
    if (this.mapAcc < 1 / 30) return;
    this.mapAcc = 0;
    const c = this.mapCtx;
    c.clearRect(0, 0, this.map.width, this.map.height);
    c.drawImage(this.mapBg, 0, 0);
    for (let i = 0; i < this.cpS.length; i++) {
      const f = this.track.frameAt(this.cpS[i]);
      const [x, y] = this.toMap(f.x, f.z);
      c.fillStyle = i < nextCp ? '#7dff9a' : '#2a9df4';
      c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
    }
    if (mp && mp.others) {
      for (const o of mp.others) {
        const [x, y] = this.toMap(o.x, o.z);
        c.fillStyle = o.css;
        c.strokeStyle = '#000';
        c.lineWidth = 1.5;
        c.beginPath(); c.arc(x, y, 4.5, 0, Math.PI * 2); c.fill(); c.stroke();
      }
    }
    // focus: undefined = meu carro; null = nenhum (espectador sem alvo)
    const focus = mp ? mp.focus : undefined;
    if (focus !== null) {
      const fx0 = focus ? focus.x : car.pos[0];
      const fz0 = focus ? focus.z : car.pos[2];
      const fx = focus ? focus.fx : car.R[6], fz = focus ? focus.fz : car.R[8];
      const [cx, cy] = this.toMap(fx0, fz0);
      c.save();
      c.translate(cx, cy);
      // no mapa a frente do carro vira (-fx, -fz); a seta e desenhada apontando para cima
      c.rotate(Math.atan2(-fx, fz));
      c.fillStyle = '#ffd60a';
      c.strokeStyle = '#000';
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(0, -8); c.lineTo(5.5, 6); c.lineTo(-5.5, 6); c.closePath();
      c.fill(); c.stroke();
      c.restore();
    }
  }
}

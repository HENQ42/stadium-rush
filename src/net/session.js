// Sala multiplayer: protocolo entre o master (host) e os jogadores.
//
// O master e a autoridade da sala: lista de jogadores, largada, posicoes
// oficiais e resultado. Cada jogador simula o proprio carro (fisica local,
// sem atraso de controle) e envia a posicao 30x por segundo; o master repassa
// imediatamente para os outros. Os tempos usam o relogio do master,
// sincronizado por ping/pong (estilo NTP), para todos largarem juntos.
import { Emitter, HostTransport, connectToRoom, publishRoom } from './transport.js';
import { PLAYER_COLORS } from './protocol.js';

export * from './protocol.js';

export const PROTOCOL = 1;
export const MAX_PLAYERS = 8;
const HOST_ID = 'host';
const LINK_TIMEOUT = 20000; // sem nenhuma mensagem por 20 s: conexao perdida
const START_DELAY = 4200; // ms entre "iniciar" e o GO (3 s de contagem + carga)



const now = () => performance.now();
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, min, max, def = 0) => (isNum(v) ? Math.max(min, Math.min(max, v)) : def);

export const CODE_LENGTH = 4;

// Codigo da sala: so letras A-Z, maiusculas.
export function cleanCode(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);
}

export function makeRoomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I e O (confundem com 1 e 0)
  const buf = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(buf);
  return Array.from(buf, (v) => abc[v % abc.length]).join('');
}

export function cleanName(name) {
  const n = String(name || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return n || 'Piloto';
}

export function cleanSettings(s = {}) {
  return {
    laps: Math.round(num(s.laps, 1, 20, 3)),
    collisions: !!s.collisions,
    fuel: Math.round(num(s.fuel, 0, 120, 20)),
    track: typeof s.track === 'string' ? s.track.slice(0, 24) : 'speedway',
  };
}

// Estado do carro enviado pela rede. Remonta o objeto so com campos esperados.
export function sanitizeState(m) {
  const arr = (a, n, lim) => (Array.isArray(a) && a.length === n && a.every(isNum) ? a.map((v) => Math.max(-lim, Math.min(lim, v))) : null);
  const p = arr(m.p, 3, 1e5);
  const q = arr(m.q, 4, 1.01);
  if (!p || !q) return null;
  return {
    t: 'st',
    n: Math.round(num(m.n, 0, 1e9)),
    h: num(m.h, -1e12, 1e12),
    p,
    q,
    v: arr(m.v, 3, 500) || [0, 0, 0],
    s: num(m.s, -1, 1),
    k: num(m.k, -200, 200),
    a: num(m.a, 0, 1),
    f: Math.round(num(m.f, 0, 1023)) | 0,
    g: num(m.g, -1e5, 1e7),
    rt: num(m.rt, 0, 360000),
    l: Math.round(num(m.l, 0, 99)),
    c: Math.round(num(m.c, 0, 99)),
  };
}



function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    host: p.id === HOST_ID,
    status: p.status,
    lap: p.lap,
    cp: p.cp,
    totalTime: p.totalTime,
    bestLap: p.bestLap,
    dnfReason: p.dnfReason,
  };
}

function newPlayer(id, name, color) {
  return { id, name, color, status: 'lobby', lap: 1, cp: 0, totalTime: null, bestLap: null, lapTimes: [], dnfReason: null, progress: 0 };
}

export class RoomSession extends Emitter {
  // ---------------- criacao ----------------
  // code: codigo escolhido pelo master; vazio = aleatorio
  static async host({ name, settings, code: wanted = '' }) {
    wanted = cleanCode(wanted);
    if (wanted && wanted.length !== CODE_LENGTH) throw new Error(`O codigo precisa ter ${CODE_LENGTH} letras`);
    let transport = null;
    let code = null;
    let lastErr = null;
    for (let i = 0; i < (wanted ? 1 : 4) && !transport; i++) {
      code = wanted || makeRoomCode();
      try {
        transport = await HostTransport.create(code);
      } catch (err) {
        lastErr = err;
        if (!/codigo/.test(err.message)) break;
      }
    }
    if (!transport) {
      if (wanted && lastErr && /codigo/.test(lastErr.message)) throw new Error(`Ja existe uma sala com o codigo ${wanted}. Escolha outro.`);
      throw lastErr || new Error('Nao foi possivel criar a sala');
    }
    const s = new RoomSession('host');
    s._initHost(transport, code, cleanName(name), cleanSettings(settings));
    return s;
  }

  static async join({ name, code, onStatus }) {
    code = cleanCode(code);
    if (code.length !== CODE_LENGTH) throw new Error(`O codigo da sala tem ${CODE_LENGTH} letras`);
    const link = await connectToRoom(code, onStatus);
    const s = new RoomSession('client');
    try {
      await s._initClient(link, code, cleanName(name), onStatus);
    } catch (err) {
      link.close();
      throw err;
    }
    return s;
  }

  constructor(role) {
    super();
    this.role = role;
    this.isHost = role === 'host';
    this.players = new Map();
    this.phase = 'lobby';
    this.race = null;
    this.results = null;
    this.offset = 0; // relogio do master - relogio local (ms)
    this.rtt = 0;
    this.closed = false;
    this._timers = [];
  }

  get via() {
    return this.isHost ? 'host' : this.link?.via;
  }

  // relogio do master (ms)
  now() {
    return now() + this.offset;
  }

  get self() {
    return this.players.get(this.selfId);
  }

  playerList() {
    return [...this.players.values()].sort((a, b) => a.color - b.color);
  }

  _interval(fn, ms) {
    const id = setInterval(fn, ms);
    this._timers.push(id);
    return id;
  }

  // ======================= HOST =======================
  _initHost(transport, code, name, settings) {
    this.transport = transport;
    this.code = code;
    this.settings = settings;
    this.selfId = HOST_ID;
    this.links = new Map(); // id -> { link, lastSeen, joined }
    this.entries = new Map(); // participantes da corrida atual
    this.raceSeq = 0;
    this.players.set(HOST_ID, newPlayer(HOST_ID, name, 0));
    transport.on('connection', (link) => this._hostOnLink(link));
    this._interval(() => this._hostHeartbeat(), 1000);
    this._interval(() => this._publish(), 2000);
    this._publish();
  }

  _publish() {
    if (this.closed) return;
    publishRoom({
      code: this.code,
      host: this.players.get(HOST_ID)?.name || '',
      players: this.players.size,
      max: MAX_PLAYERS,
      phase: this.phase,
      laps: this.settings.laps,
      fuel: this.settings.fuel,
      collisions: this.settings.collisions,
      track: this.settings.track,
    });
  }

  _hostOnLink(link) {
    const rec = { link, lastSeen: now(), joined: false };
    this.links.set(link.id, rec);
    link.on('message', (m) => this._hostOnMessage(rec, m));
    link.on('close', () => this._hostDrop(link.id));
    // sem hello em 8 s: derruba
    setTimeout(() => {
      if (!rec.joined && this.links.get(link.id) === rec) link.close();
    }, 8000);
  }

  _hostOnMessage(rec, m) {
    rec.lastSeen = now();
    const id = rec.link.id;
    switch (m.t) {
      case 'hello': {
        if (rec.joined) return;
        if (m.v !== PROTOCOL) {
          rec.link.send({ t: 'reject', reason: 'Versao do jogo diferente da do master. Atualize a pagina.' });
          setTimeout(() => rec.link.close(), 300);
          return;
        }
        if (this.players.size >= MAX_PLAYERS) {
          rec.link.send({ t: 'reject', reason: `Sala cheia (${MAX_PLAYERS} jogadores)` });
          setTimeout(() => rec.link.close(), 300);
          return;
        }
        let name = cleanName(m.name);
        const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
        if (taken.has(name.toLowerCase())) {
          let k = 2;
          while (taken.has(`${name.slice(0, 13)} ${k}`.toLowerCase())) k++;
          name = `${name.slice(0, 13)} ${k}`;
        }
        const used = new Set([...this.players.values()].map((p) => p.color));
        let color = 0;
        while (used.has(color)) color++;
        const p = newPlayer(id, name, color);
        p.status = this.phase === 'lobby' ? 'lobby' : 'spectator';
        this.players.set(id, p);
        rec.joined = true;
        rec.link.send({
          t: 'welcome',
          you: id,
          code: this.code,
          settings: this.settings,
          phase: this.phase,
          race: this.race,
          results: this.results,
          players: this.playerList().map(publicPlayer),
          h: now(),
        });
        this._broadcastRoster();
        this.emit('toast', `${name} entrou na sala`);
        this._publish();
        break;
      }
      case 'ping':
        rec.link.send({ t: 'pong', a: m.a, h: now() }, true);
        break;
      case 'st': {
        const p = this.players.get(id);
        if (!rec.joined || !p || p.status !== 'racing' || this.phase !== 'racing') return;
        const st = sanitizeState(m);
        if (!st) return;
        st.id = id;
        p.progress = st.g;
        for (const [oid, o] of this.links) if (oid !== id && o.joined) o.link.send(st, true);
        this.emit('state', id, st);
        break;
      }
      case 'ev':
        if (rec.joined) this._applyEvent(id, m);
        break;
      case 'bye':
        rec.link.close();
        break;
      default:
        break;
    }
  }

  _hostHeartbeat() {
    const t = now();
    for (const [id, rec] of this.links) {
      if (t - rec.lastSeen > LINK_TIMEOUT) {
        console.warn(`[sala] ${id} sem resposta ha ${Math.round((t - rec.lastSeen) / 1000)} s, removendo`);
        rec.link.close();
        this._hostDrop(id);
      }
    }
  }

  _hostDrop(id) {
    const rec = this.links.get(id);
    if (!rec) return;
    this.links.delete(id);
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    const entry = this.entries.get(id);
    if (entry && this.phase === 'racing' && entry.status === 'racing') {
      entry.status = 'dnf';
      entry.dnfReason = 'left';
    }
    this.emit('toast', `${p.name} saiu da sala`);
    this.emit('left', id);
    this._broadcast({ t: 'left', id });
    this._broadcastRoster();
    this._publish();
    this._checkEnd();
  }

  _broadcast(msg, fast = false) {
    for (const rec of this.links.values()) if (rec.joined) rec.link.send(msg, fast);
  }

  _broadcastRoster() {
    const players = this.playerList().map(publicPlayer);
    this._broadcast({ t: 'roster', phase: this.phase, players });
    this.emit('roster', this.playerList());
  }

  _applyEvent(id, ev) {
    const p = this.entries.get(id);
    if (!p || this.phase !== 'racing' || p.status !== 'racing') return;
    const laps = this.settings.laps;
    if (ev.e === 'cp') {
      p.lap = Math.round(num(ev.lap, 1, laps, p.lap));
      p.cp = Math.round(num(ev.cp, 0, 99, p.cp));
    } else if (ev.e === 'lap') {
      const t = num(ev.time, 0, 36000, NaN);
      if (isNum(t)) {
        p.lapTimes.push(t);
        if (p.bestLap == null || t < p.bestLap) p.bestLap = t;
      }
      p.lap = Math.min(laps, Math.round(num(ev.lap, 1, laps, p.lap)) + 1);
      p.cp = 0;
    } else if (ev.e === 'finish') {
      p.status = 'finished';
      p.totalTime = num(ev.total, 0, 360000, null);
      if (Array.isArray(ev.laps)) p.lapTimes = ev.laps.filter(isNum).slice(0, 50);
      if (isNum(ev.best)) p.bestLap = ev.best;
      p.lap = laps;
      this.emit('toast', `${p.name} terminou!`);
    } else if (ev.e === 'dnf') {
      p.status = 'dnf';
      p.dnfReason = ev.reason === 'fuel' ? 'fuel' : 'other';
      this.emit('toast', p.dnfReason === 'fuel' ? `${p.name} ficou sem combustivel` : `${p.name} abandonou`);
    } else return;
    this._broadcastRoster();
    this._checkEnd();
  }

  _checkEnd() {
    if (!this.isHost || this.phase !== 'racing') return;
    for (const p of this.entries.values()) if (p.status === 'racing') return;
    this.endRace();
  }

  _computeResults() {
    const list = [...this.entries.values()];
    const fin = list.filter((p) => p.status === 'finished').sort((a, b) => a.totalTime - b.totalTime);
    const rest = list.filter((p) => p.status !== 'finished').sort((a, b) => (b.progress || 0) - (a.progress || 0));
    let fastest = null;
    for (const p of list) if (p.bestLap != null && (fastest == null || p.bestLap < fastest)) fastest = p.bestLap;
    const winner = fin[0]?.totalTime;
    return [...fin, ...rest].map((p, i) => ({
      pos: i + 1,
      id: p.id,
      name: p.name,
      color: p.color,
      status: p.status,
      dnfReason: p.dnfReason,
      totalTime: p.totalTime,
      gap: p.status === 'finished' && winner != null ? p.totalTime - winner : null,
      bestLap: p.bestLap,
      fastestLap: p.bestLap != null && p.bestLap === fastest,
      laps: p.status === 'finished' ? this.settings.laps : Math.max(0, p.lap - 1),
    }));
  }

  // --- acoes do master ---
  startRace() {
    if (!this.isHost || this.phase === 'racing') return;
    const ids = [...this.players.keys()];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    this.entries = new Map();
    for (const id of ids) {
      const p = this.players.get(id);
      Object.assign(p, { status: 'racing', lap: 1, cp: 0, totalTime: null, bestLap: null, lapTimes: [], dnfReason: null, progress: 0 });
      this.entries.set(id, p);
    }
    this.phase = 'racing';
    this.results = null;
    this.race = { id: ++this.raceSeq, goAt: now() + START_DELAY, grid: ids, settings: this.settings };
    const players = this.playerList().map(publicPlayer);
    this._broadcast({ t: 'start', race: this.race, players });
    this.emit('roster', this.playerList());
    this.emit('start', this.race);
    this._publish();
  }

  endRace() {
    if (!this.isHost || this.phase !== 'racing') return;
    for (const p of this.entries.values()) {
      if (p.status === 'racing') {
        p.status = 'dnf';
        p.dnfReason = 'ended';
      }
    }
    this.phase = 'results';
    this.results = this._computeResults();
    for (const p of this.players.values()) if (p.status === 'spectator') p.status = 'lobby';
    const players = this.playerList().map(publicPlayer);
    this._broadcast({ t: 'end', results: this.results, players });
    this.emit('roster', this.playerList());
    this.emit('results', this.results);
    this._publish();
  }

  backToLobby() {
    if (!this.isHost || this.phase === 'racing') return;
    this.phase = 'lobby';
    for (const p of this.players.values()) p.status = 'lobby';
    this._broadcast({ t: 'lobby', players: this.playerList().map(publicPlayer) });
    this.emit('roster', this.playerList());
    this.emit('phase', this.phase);
    this._publish();
  }

  kick(id) {
    if (!this.isHost || id === HOST_ID) return;
    const rec = this.links.get(id);
    if (!rec) return;
    rec.link.send({ t: 'reject', reason: 'Voce foi removido da sala pelo master' });
    setTimeout(() => {
      rec.link.close();
      this._hostDrop(id);
    }, 200);
  }

  // ======================= CLIENTE =======================
  _initClient(link, code, name, onStatus = () => {}) {
    this.link = link;
    this.code = code;
    this.lastHostMsg = now();
    this.clockSamples = [];
    return new Promise((resolve, reject) => {
      let welcomed = false;
      const timer = setTimeout(() => !welcomed && reject(new Error('O master nao respondeu')), 9000);
      link.on('message', (m) => {
        this.lastHostMsg = now();
        if (!welcomed) {
          if (m.t === 'welcome') {
            welcomed = true;
            clearTimeout(timer);
            this._onWelcome(m);
            resolve();
          } else if (m.t === 'reject') {
            clearTimeout(timer);
            reject(new Error(String(m.reason || 'Entrada recusada').slice(0, 120)));
          }
          return;
        }
        this._clientOnMessage(m);
      });
      link.on('close', () => {
        clearTimeout(timer);
        if (!welcomed) reject(new Error('Conexao fechada pelo master'));
        else this._closed(this._rejectReason || 'Conexao com o master perdida');
      });
      onStatus('Entrando na sala...');
      link.send({ t: 'hello', v: PROTOCOL, name });
    });
  }

  _setPlayers(list) {
    const map = new Map();
    for (const p of list || []) {
      if (!p || typeof p.id !== 'string') continue;
      const old = this.players.get(p.id) || newPlayer(p.id, '', 0);
      map.set(p.id, {
        ...old,
        id: p.id,
        name: cleanName(p.name),
        color: Math.round(num(p.color, 0, PLAYER_COLORS.length - 1)),
        status: String(p.status || 'lobby'),
        lap: Math.round(num(p.lap, 0, 99, 1)),
        cp: Math.round(num(p.cp, 0, 99)),
        totalTime: isNum(p.totalTime) ? p.totalTime : null,
        bestLap: isNum(p.bestLap) ? p.bestLap : null,
        dnfReason: p.dnfReason || null,
      });
    }
    this.players = map;
  }

  _onWelcome(m) {
    this.selfId = m.you;
    this.settings = cleanSettings(m.settings);
    this.phase = m.phase;
    this.race = m.race || null;
    this.results = m.results || null;
    this._setPlayers(m.players);
    // estimativa inicial do relogio (corrigida pelos pings)
    this.offset = num(m.h, -1e12, 1e12) - now();
    this._ping();
    let fast = 0;
    const fastTimer = this._interval(() => {
      this._ping();
      if (++fast >= 10) clearInterval(fastTimer);
    }, 150);
    this._interval(() => this._ping(), 1000);
    this._interval(() => {
      if (now() - this.lastHostMsg > LINK_TIMEOUT) {
        this.link.close();
        this._closed('Conexao com o master perdida');
      }
    }, 1000);
  }

  _ping() {
    if (!this.closed) this.link.send({ t: 'ping', a: now() }, true);
  }

  _clientOnMessage(m) {
    switch (m.t) {
      case 'pong': {
        if (!isNum(m.a) || !isNum(m.h)) return;
        const t = now();
        const rtt = t - m.a;
        if (rtt < 0 || rtt > 5000) return;
        this.clockSamples.push({ rtt, off: m.h - (m.a + rtt / 2) });
        if (this.clockSamples.length > 15) this.clockSamples.shift();
        let best = this.clockSamples[0];
        for (const s of this.clockSamples) if (s.rtt < best.rtt) best = s;
        this.offset = best.off;
        this.rtt = rtt;
        break;
      }
      case 'st': {
        const st = sanitizeState(m);
        if (!st || typeof m.id !== 'string' || m.id === this.selfId) return;
        st.id = m.id;
        const p = this.players.get(m.id);
        if (p) p.progress = st.g;
        this.emit('state', m.id, st);
        break;
      }
      case 'roster':
        this._setPlayers(m.players);
        if (m.phase && m.phase !== this.phase) {
          this.phase = m.phase;
          this.emit('phase', this.phase);
        }
        this.emit('roster', this.playerList());
        break;
      case 'start':
        if (!m.race || !Array.isArray(m.race.grid) || !isNum(m.race.goAt)) return;
        this.race = { ...m.race, settings: cleanSettings(m.race.settings) };
        this.settings = this.race.settings;
        this.phase = 'racing';
        this.results = null;
        this._setPlayers(m.players);
        this.emit('roster', this.playerList());
        this.emit('start', this.race);
        break;
      case 'end':
        this.phase = 'results';
        this.results = Array.isArray(m.results) ? m.results.slice(0, MAX_PLAYERS * 2) : [];
        this._setPlayers(m.players);
        this.emit('roster', this.playerList());
        this.emit('results', this.results);
        break;
      case 'lobby':
        this.phase = 'lobby';
        this._setPlayers(m.players);
        this.emit('roster', this.playerList());
        this.emit('phase', this.phase);
        break;
      case 'left':
        this.emit('left', m.id);
        break;
      case 'reject':
        this._rejectReason = String(m.reason || '').slice(0, 120);
        break;
      case 'closed':
        this._rejectReason = 'O master fechou a sala';
        break;
      default:
        break;
    }
  }

  // ======================= API do jogo =======================
  // Estado do proprio carro (chamado ~30x por segundo durante a corrida).
  sendState(st) {
    if (this.closed) return;
    if (this.isHost) {
      const p = this.players.get(HOST_ID);
      if (!p || p.status !== 'racing' || this.phase !== 'racing') return;
      p.progress = st.g;
      st.id = HOST_ID;
      this._broadcast(st, true);
    } else {
      this.link.send(st, true);
    }
  }

  // Eventos da corrida: { e: 'cp'|'lap'|'finish'|'dnf', ... }
  reportEvent(ev) {
    if (this.closed) return;
    if (this.isHost) this._applyEvent(HOST_ID, ev);
    else this.link.send({ t: 'ev', ...ev });
  }

  leave() {
    if (this.closed) return;
    if (this.isHost) {
      this._broadcast({ t: 'closed' });
      publishRoom({ code: this.code, closed: true });
      setTimeout(() => this.transport.close(), 150);
    } else {
      this.link.send({ t: 'bye' });
      setTimeout(() => this.link.close(), 150);
    }
    this._closed(null);
  }

  _closed(reason) {
    if (this.closed) return;
    if (reason) console.warn('[sala] fechada:', reason);
    this.closed = true;
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
    this.emit('closed', reason);
  }
}

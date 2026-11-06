// Transporte de rede: WebRTC (PeerJS) com relay WebSocket de reserva.
//
// Topologia em estrela: o master (host) abre um Peer com id fixo derivado do
// codigo da sala e cada jogador conecta nele. Por jogador ha dois canais:
//   ctrl  - confiavel e ordenado (entrar, largada, checkpoints, resultados)
//   state - nao ordenado (posicao dos carros 30x por segundo, sem bloqueio
//           por pacote atrasado)
// A sinalizacao (troca de ofertas WebRTC) passa por WebSocket: o servidor
// local (npm run lan) em /peerjs ou, sem ele, o servidor publico do PeerJS.
// Se o WebRTC nao abrir (rede bloqueando, mDNS etc.), o cliente cai para o
// relay WebSocket do servidor local (/relay).
import { Peer } from 'peerjs';

export const PEER_PREFIX = 'stadiumrush-';
const P2P_TIMEOUT = 7000;

export class Emitter {
  constructor() {
    this._ls = {};
  }
  on(ev, fn) {
    (this._ls[ev] ||= []).push(fn);
    return this;
  }
  off(ev, fn) {
    this._ls[ev] = (this._ls[ev] || []).filter((f) => f !== fn);
  }
  emit(ev, ...args) {
    for (const fn of this._ls[ev] || []) {
      try {
        fn(...args);
      } catch (err) {
        console.error(err);
      }
    }
  }
}

let infoPromise = null;
// Detecta o servidor local (server/server.mjs). null = sem servidor.
export function getServerInfo() {
  infoPromise ||= fetch('/api/info', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && j.server === 'stadium-rush' ? j : null))
    .catch(() => null);
  return infoPromise;
}

function peerOptions(info) {
  const opts = { debug: 1 };
  if (info) {
    const secure = location.protocol === 'https:';
    opts.host = location.hostname;
    opts.port = Number(location.port) || (secure ? 443 : 80);
    opts.path = info.peerPath || '/peerjs';
    opts.secure = secure;
  }
  return opts;
}

function relayUrl(params) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/relay?${new URLSearchParams(params)}`;
}

export function randomId(len = 12) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += abc[buf[i] % abc.length];
  return s;
}

function forceRelay() {
  return new URLSearchParams(location.search).get('net') === 'ws';
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function waitPeerOpen(peer) {
  return new Promise((res, rej) => {
    if (peer.open) return res(peer.id);
    const onErr = (err) => rej(err);
    peer.once('open', (id) => {
      peer.off('error', onErr);
      res(id);
    });
    peer.once('error', onErr);
  });
}

function waitConnOpen(conn, peer) {
  return new Promise((res, rej) => {
    if (conn.open) return res();
    const onPeerErr = (err) => rej(err);
    conn.once('open', () => {
      peer.off('error', onPeerErr);
      res();
    });
    conn.once('error', rej);
    peer.on('error', onPeerErr);
  });
}

// ---------------------------------------------------------------------------
// Link: uma conexao com um jogador (lado host) ou com o host (lado cliente).
// send(msg, fast): fast = usar o canal de estado (nao ordenado) se existir.
// Eventos: 'message' (msg), 'close'.
// ---------------------------------------------------------------------------
class PeerLink extends Emitter {
  constructor(id, ctrl) {
    super();
    this.id = id;
    this.via = 'p2p';
    this.ctrl = ctrl;
    this.state = null;
    this.closed = false;
    this._wire(ctrl);
  }
  _wire(dc) {
    dc.on('data', (m) => {
      if (!this.closed && m && typeof m === 'object') this.emit('message', m);
    });
    dc.on('close', () => {
      if (dc === this.ctrl) this._closed();
      else if (dc === this.state) this.state = null;
    });
    dc.on('error', () => {
      if (dc === this.ctrl) this._closed();
    });
  }
  attachState(dc) {
    this.state = dc;
    this._wire(dc);
  }
  send(msg, fast = false) {
    if (this.closed) return;
    const dc = fast && this.state && this.state.open ? this.state : this.ctrl;
    if (!dc.open) return;
    try {
      dc.send(msg);
    } catch {
      /* canal fechando */
    }
  }
  close() {
    if (this.closed) return;
    try {
      this.state?.close();
      this.ctrl.close();
    } catch {
      /* ignore */
    }
    this._closed();
  }
  _closed() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
}

// Cliente visto pelo host atraves do relay.
class RelayHostLink extends Emitter {
  constructor(id, ws) {
    super();
    this.id = id;
    this.via = 'relay';
    this.ws = ws;
    this.closed = false;
  }
  send(msg) {
    if (!this.closed && this.ws.readyState === 1) this.ws.send(JSON.stringify({ to: this.id, d: msg }));
  }
  close() {
    if (this.closed) return;
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ to: this.id, close: true }));
    this._closed();
  }
  _closed() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
}

// Host visto pelo cliente atraves do relay.
class RelayClientLink extends Emitter {
  constructor(ws) {
    super();
    this.id = 'host';
    this.via = 'relay';
    this.ws = ws;
    this.closed = false;
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m && typeof m === 'object') this.emit('message', m);
    };
    ws.onclose = () => this._closed();
  }
  send(msg) {
    if (!this.closed && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    this._closed();
  }
  _closed() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
}

// ---------------------------------------------------------------------------
// Host
// Eventos: 'connection' (link)
// ---------------------------------------------------------------------------
export class HostTransport extends Emitter {
  static async create(code) {
    const t = new HostTransport(code);
    await t._open();
    return t;
  }

  constructor(code) {
    super();
    this.code = code;
    this.peer = null;
    this.ws = null;
    this.relayLinks = new Map();
    this.peerLinks = new Map();
    this.pendingState = new Map();
    this.closed = false;
  }

  async _open() {
    const info = await getServerInfo();
    this.info = info;
    if (!forceRelay() || !info) {
      const peer = new Peer(PEER_PREFIX + this.code.toLowerCase(), peerOptions(info));
      this.peer = peer;
      try {
        await withTimeout(waitPeerOpen(peer), 10000, 'Sem resposta do servidor de sinalizacao');
      } catch (err) {
        peer.destroy();
        this.peer = null;
        if (err && err.type === 'unavailable-id') throw new Error('Ja existe uma sala com esse codigo');
        if (!info) throw new Error(`Nao foi possivel abrir a sala: ${err.message || err.type || err}`);
        console.warn('PeerJS indisponivel, usando apenas o relay WebSocket', err);
      }
      if (this.peer) {
        peer.on('connection', (dc) => this._onDataConnection(dc));
        peer.on('disconnected', () => {
          if (!this.closed && !peer.destroyed) setTimeout(() => !this.closed && !peer.destroyed && peer.reconnect(), 1000);
        });
        peer.on('error', (err) => console.warn('PeerJS:', err.type || err));
      }
    }
    if (info && info.relay) {
      try {
        await this._openRelay();
      } catch (err) {
        if (!this.peer) throw err;
        console.warn('relay indisponivel', err);
      }
    }
  }

  _openRelay() {
    return new Promise((res, rej) => {
      const ws = new WebSocket(relayUrl({ room: this.code, role: 'host', id: 'host' }));
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.ws = ws;
        res();
      };
      ws.onerror = () => !opened && rej(new Error('Relay indisponivel'));
      ws.onclose = (e) => {
        if (!opened) rej(new Error(e.code === 4001 ? 'Ja existe uma sala com esse codigo' : 'Relay indisponivel'));
        for (const l of this.relayLinks.values()) l._closed();
        this.relayLinks.clear();
        if (this.ws === ws) this.ws = null;
      };
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (!m || typeof m.from !== 'string') return;
        let link = this.relayLinks.get(m.from);
        if (m.open) {
          if (link) link._closed();
          link = new RelayHostLink(m.from, ws);
          this.relayLinks.set(m.from, link);
          link.on('close', () => this.relayLinks.get(m.from) === link && this.relayLinks.delete(m.from));
          this.emit('connection', link);
        } else if (m.closed) {
          if (link) link._closed();
        } else if (link && m.d && typeof m.d === 'object') {
          link.emit('message', m.d);
        }
      };
    });
  }

  _onDataConnection(dc) {
    const id = dc.peer;
    dc.on('open', () => {
      if (dc.label === 'state') {
        const link = this.peerLinks.get(id);
        if (link && !link.closed) link.attachState(dc);
        else this.pendingState.set(id, dc);
        return;
      }
      const old = this.peerLinks.get(id);
      if (old) old.close();
      const link = new PeerLink(id, dc);
      this.peerLinks.set(id, link);
      link.on('close', () => this.peerLinks.get(id) === link && this.peerLinks.delete(id));
      const pending = this.pendingState.get(id);
      if (pending) {
        link.attachState(pending);
        this.pendingState.delete(id);
      }
      this.emit('connection', link);
    });
  }

  close() {
    this.closed = true;
    for (const l of [...this.peerLinks.values(), ...this.relayLinks.values()]) l.close();
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Cliente: conecta no host da sala. Retorna um link (send/on/close).
// ---------------------------------------------------------------------------
export async function connectToRoom(code, onStatus = () => {}) {
  const info = await getServerInfo();
  const hostId = PEER_PREFIX + code.toLowerCase();
  let p2pError = null;
  if (!forceRelay() || !info) {
    onStatus('Conectando (WebRTC)...');
    const peer = new Peer(peerOptions(info));
    try {
      await withTimeout(waitPeerOpen(peer), 8000, 'Sem resposta do servidor de sinalizacao');
      const ctrl = peer.connect(hostId, { label: 'ctrl', reliable: true, serialization: 'json' });
      await withTimeout(waitConnOpen(ctrl, peer), P2P_TIMEOUT, 'Tempo esgotado ao conectar via WebRTC');
      const link = new PeerLink('host', ctrl);
      link.peer = peer;
      // canal rapido para posicoes; se nao abrir, o ctrl e usado
      const state = peer.connect(hostId, { label: 'state', reliable: false, serialization: 'json' });
      state.on('open', () => !link.closed && link.attachState(state));
      peer.on('disconnected', () => {
        if (!link.closed && !peer.destroyed) setTimeout(() => !link.closed && !peer.destroyed && peer.reconnect(), 1000);
      });
      link.on('close', () => setTimeout(() => peer.destroy(), 200));
      return link;
    } catch (err) {
      peer.destroy();
      if (err && err.type === 'peer-unavailable') throw new Error('Sala nao encontrada');
      p2pError = err;
      console.warn('WebRTC falhou', err);
    }
  }
  if (!info || !info.relay) {
    throw new Error(p2pError ? `Falha ao conectar: ${p2pError.message || p2pError.type || p2pError}` : 'Falha ao conectar');
  }
  onStatus('Conectando (WebSocket)...');
  const ws = new WebSocket(relayUrl({ room: code, role: 'client', id: randomId() }));
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onclose = (e) => rej(new Error(e.code === 4004 ? 'Sala nao encontrada' : 'Falha ao conectar no relay'));
  });
  return new RelayClientLink(ws);
}

// Lista de salas abertas (so com o servidor local).
export async function listRooms() {
  const info = await getServerInfo();
  if (!info) return null;
  try {
    const r = await fetch('/api/rooms', { cache: 'no-store' });
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

export async function publishRoom(meta) {
  const info = await getServerInfo();
  if (!info) return;
  try {
    await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta), keepalive: true });
  } catch {
    /* servidor fora do ar */
  }
}

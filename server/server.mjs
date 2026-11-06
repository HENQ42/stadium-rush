// Servidor para jogar em rede local (LAN):
//  - serve o jogo compilado (dist/)
//  - servidor de sinalizacao PeerJS (WebSocket) em /peerjs, para os
//    navegadores abrirem conexoes WebRTC diretas entre si
//  - relay WebSocket em /relay, usado quando o WebRTC nao conecta
//  - lista de salas abertas em /api/rooms (para achar a sala na rede)
//
// Uso: npm run lan   (compila e inicia)   ou   npm run server
// Variaveis: PORT (padrao 8080), HOST (padrao 0.0.0.0)
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ExpressPeerServer } from 'peer';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');

const ROOM_RE = /^[A-Z0-9]{3,12}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ROOM_TTL = 8000;

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);

// ---------------- sinalizacao PeerJS ----------------
let peerWss = null;
const peerServer = ExpressPeerServer(server, {
  path: '/',
  // o WebSocket da sinalizacao divide a porta com o relay: roteamos o upgrade manualmente
  createWebSocketServer: (opts) => (peerWss = new WebSocketServer({ noServer: true, path: opts.path, maxPayload: 64 * 1024 })),
});
app.use('/peerjs', peerServer);

// ---------------- lista de salas ----------------
const listed = new Map(); // code -> { meta, at }
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v, min, max) => (Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : min);

app.use('/api', express.json({ limit: '4kb' }));
app.get('/api/info', (_req, res) => {
  res.json({ server: 'stadium-rush', version: 1, relay: true, peerPath: '/peerjs' });
});
app.get('/api/rooms', (_req, res) => {
  const now = Date.now();
  const out = [];
  for (const [code, r] of listed) {
    if (now - r.at > ROOM_TTL) listed.delete(code);
    else out.push(r.meta);
  }
  res.json(out);
});
app.post('/api/rooms', (req, res) => {
  const b = req.body || {};
  const code = str(b.code, 12).toUpperCase();
  if (!ROOM_RE.test(code)) return res.status(400).json({ error: 'codigo invalido' });
  if (b.closed) {
    listed.delete(code);
    return res.json({ ok: true });
  }
  listed.set(code, {
    at: Date.now(),
    meta: {
      code,
      host: str(b.host, 24),
      players: int(b.players, 0, 64),
      max: int(b.max, 1, 64),
      phase: str(b.phase, 16),
      laps: int(b.laps, 1, 99),
      fuel: int(b.fuel, 0, 999),
      collisions: !!b.collisions,
      track: str(b.track, 24),
    },
  });
  res.json({ ok: true });
});

// ---------------- relay WebSocket ----------------
// Cada sala tem um host (master) e N clientes. Mensagens de cliente vao para o
// host como {from, d}; o host manda {to, d} (to = id do cliente ou '*').
const relayWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const relayRooms = new Map(); // code -> { host, clients: Map<id, ws> }

function sendJson(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

relayWss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://local').searchParams;
  const code = (q.get('room') || '').toUpperCase();
  const role = q.get('role');
  const id = q.get('id') || '';
  if (!ROOM_RE.test(code) || !ID_RE.test(id)) {
    ws.close(4000, 'parametros invalidos');
    return;
  }
  ws.on('error', () => {});
  if (role === 'host') {
    const existing = relayRooms.get(code);
    if (existing && existing.host.readyState === 1) {
      ws.close(4001, 'sala ja existe');
      return;
    }
    const room = { host: ws, clients: new Map() };
    relayRooms.set(code, room);
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      const payload = JSON.stringify(msg.d);
      if (msg.to === '*') {
        for (const c of room.clients.values()) if (c.readyState === 1) c.send(payload);
      } else if (typeof msg.to === 'string') {
        const c = room.clients.get(msg.to);
        if (msg.close) c?.close(4003, 'removido');
        else if (c && c.readyState === 1) c.send(payload);
      }
    });
    ws.on('close', () => {
      if (relayRooms.get(code) === room) relayRooms.delete(code);
      for (const c of room.clients.values()) c.close(4002, 'master saiu');
    });
  } else {
    const room = relayRooms.get(code);
    if (!room || room.host.readyState !== 1) {
      ws.close(4004, 'sala nao encontrada');
      return;
    }
    if (room.clients.has(id)) {
      ws.close(4005, 'id em uso');
      return;
    }
    room.clients.set(id, ws);
    sendJson(room.host, { from: id, open: true });
    ws.on('message', (data) => {
      const text = data.toString();
      // valida para nao repassar lixo ao host
      try {
        JSON.parse(text);
      } catch {
        return;
      }
      if (room.host.readyState === 1) room.host.send(`{"from":${JSON.stringify(id)},"d":${text}}`);
    });
    ws.on('close', () => {
      if (room.clients.get(id) === ws) room.clients.delete(id);
      sendJson(room.host, { from: id, closed: true });
    });
  }
});

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://local');
  if (pathname === '/relay') {
    relayWss.handleUpgrade(req, socket, head, (ws) => relayWss.emit('connection', ws, req));
  } else if (pathname.startsWith('/peerjs') && peerWss) {
    peerWss.handleUpgrade(req, socket, head, (ws) => peerWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// ---------------- arquivos do jogo ----------------
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir, { index: 'index.html', maxAge: '1h' }));
  app.get(/^\/(?!api|peerjs|relay).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
  console.warn('Aviso: dist/ nao encontrado. Rode "npm run build" (ou use "npm run lan").');
}

server.listen(PORT, HOST, () => {
  console.log(`Stadium Rush rodando na porta ${PORT}`);
  const nets = HOST === '0.0.0.0' || HOST === '::' ? os.networkInterfaces() : {};
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  na rede local: http://${n.address}:${PORT}`);
    }
  }
  console.log(`  nesta maquina: http://localhost:${PORT}`);
});

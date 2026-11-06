import * as THREE from 'three';
import './style.css';
import { StadiumCar, PHYSICS_DT } from './physics/stadiumCar.js';
import { createCarModel, setCarStyle } from './scene/carModel.js';
import { RetroPipeline, precompileScene } from './game/retro.js';
import { EngineAudio } from './audio/engineAudio.js';
import { Race, formatTime } from './game/race.js';
import { Input } from './game/input.js';
import { ChaseCamera } from './game/chaseCamera.js';
import { Hud } from './game/hud.js';
import { createWorld } from './game/world.js';
import { RemoteCars, collideCar } from './game/remoteCars.js';
import { Menu, statusText } from './ui/menu.js';
import { listRooms } from './net/transport.js';
import { RoomSession, PLAYER_COLORS, F_BRAKE, F_TURBO, F_GHOST, F_SLIDE, F_GROUND, F_REVERSE } from './net/session.js';
import { loadQualityPref, storeQualityPref, resolveQuality, targetPixelRatio, DynamicResolution } from './game/quality.js';

const STATE_RATE = 30; // pacotes de posicao por segundo
const RESPAWN_GHOST = 2.0; // s sem colisao depois do respawn (salas com colisao)

// ---------- qualidade grafica ----------
let qualityPref = loadQualityPref(); // 'auto' | 'alta' | 'media' | 'baixa'
let quality = resolveQuality(qualityPref);
applyCarStyle();

// ---------- renderizador ----------
// antialias so pode ser escolhido ao criar o contexto: mudar exige recarregar
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance' });
renderer.setPixelRatio(targetPixelRatio(quality));
renderer.setSize(window.innerWidth, window.innerHeight);
// a neblina cobre tudo a partir de 2500 m: alem disso nao ha o que desenhar
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2600);
const dynRes = new DynamicResolution(renderer);
const retroPipe = new RetroPipeline(renderer);

function applyCarStyle() {
  setCarStyle({ lite: quality.liteMaterials, retro: !!quality.retro, blob: !quality.shadows });
}

// Retro: resolucao interna fixa (renderHeight linhas), ampliada com pixels
// nitidos pelo CSS. Os outros modos usam a resolucao dinamica.
function applyRenderMode() {
  document.body.classList.toggle('retro', !!quality.retro);
  if (quality.retro) {
    renderer.setPixelRatio(Math.min(2, quality.renderHeight / Math.max(1, window.innerHeight)));
    retroPipe.syncSize();
  } else {
    dynRes.setRange(Math.min(quality.minPixelRatio, targetPixelRatio(quality)), targetPixelRatio(quality));
  }
}
applyRenderMode();

function renderFrame() {
  if (quality.retro) retroPipe.render(world.scene, camera);
  else renderer.render(world.scene, camera);
}

// shaders e texturas prontos antes da corrida (sem engasgo no 1o turbo/fumaca)
function precompile() {
  if (world) precompileScene(renderer, world.scene, camera, quality.retro ? retroPipe : null);
}

const menu = new Menu();
const audio = new EngineAudio();
const input = new Input();
const remote = new RemoteCars(document.getElementById('tags'));

// ---------- mundo (recriado ao trocar de pista) ----------
let world = null;
let track = null;
let car = null;
let chase = null;
let race = null;
let hud = null;
let ownColor = 0;
let carModel = makeCarModel(0);

function makeCarModel(colorIndex) {
  const c = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  return createCarModel({ bodyColor: c.body, accentColor: c.accent, secondaryColor: c.secondary, number: String(colorIndex + 1) });
}

function setOwnColor(idx) {
  if (idx === ownColor) return;
  ownColor = idx;
  const visible = carModel.group.visible;
  carModel.dispose();
  carModel = makeCarModel(idx);
  carModel.group.visible = visible;
  world.scene.add(carModel.group);
  precompile();
}

function loadWorld(trackId, force = false) {
  if (!force && world && world.id === trackId && world.qualityId === quality.id) return;
  if (world) {
    world.scene.remove(carModel.group);
    world.dispose();
  }
  world = createWorld(renderer, trackId, quality);
  track = world.track;
  car = new StadiumCar(track);
  chase = new ChaseCamera(camera, track);
  world.scene.add(carModel.group);
  remote.setScene(world.scene);
  if (hud) hud.setTrack(track);
  else hud = new Hud(document.getElementById('hud'), track);
  setupRace({});
  precompile();
}

// ---------- estado do jogo ----------
let mode = 'menu'; // 'menu' | 'solo' | 'mp'
let session = null;
let mpRacing = false; // meu carro esta na corrida atual
let spectateId = null;
let ghostTime = 0;
let stateAcc = 0;
let stateSeq = 0;
let lastFuelBeep = 99;
let joinToken = 0;
let spectateTimer = null;

const isDriving = () => (mode === 'solo' && !menu.pauseVisible) || (mode === 'mp' && mpRacing && !race.finished);
const carHidden = () => mode === 'mp' && session && session.phase === 'racing' && (!mpRacing || race.finished);

// ---------- corrida ----------
function setupRace(opts) {
  race = new Race(track, car, opts);
  race.on('countdown', (n) => {
    hud.showCountdown(String(n));
    audio.playCountdown(false);
  });
  race.on('go', () => {
    hud.showCountdown('GO!', 'go');
    audio.playCountdown(true);
    lastFuelBeep = 99;
  });
  race.on('checkpoint', ({ index, lap, time, diff, raceTime }) => {
    if (mode === 'mp') {
      hud.showSplit(raceTime, null, `CHECKPOINT ${index}/${race.cpS.length}`);
      session?.reportEvent({ e: 'cp', lap, cp: index });
    } else {
      hud.showSplit(time, diff, `CHECKPOINT ${index}/${race.cpS.length}`);
    }
    lastFuelBeep = 99;
    audio.playCheckpoint();
  });
  race.on('lap', ({ lap, time, diff, isBest }) => {
    if (mode === 'mp') {
      session?.reportEvent({ e: 'lap', lap, time });
      if (!(race.laps && lap >= race.laps)) hud.showSplit(time, null, `VOLTA ${lap}/${race.laps}`);
    } else {
      hud.showSplit(time, diff, isBest ? `VOLTA ${lap} · NOVO RECORDE!` : `VOLTA ${lap}`);
    }
    lastFuelBeep = 99;
    audio.playFinish(isBest);
  });
  race.on('finish', ({ totalTime, lapTimes, bestLap }) => {
    hud.showSplit(totalTime, null, 'CHEGADA!');
    session?.reportEvent({ e: 'finish', total: totalTime, best: bestLap, laps: lapTimes });
    onLocalRaceOver('Voce terminou! Assistindo os outros pilotos...');
  });
  race.on('dnf', ({ reason }) => {
    if (reason === 'fuel') {
      hud.showCountdown('SEM COMBUSTIVEL', 'out');
      hud.toast('Desclassificado: nao chegou ao checkpoint a tempo', 3);
    }
    session?.reportEvent({ e: 'dnf', reason });
    onLocalRaceOver('Desclassificado. Assistindo os outros pilotos...');
  });
  race.on('spawn', () => {
    world.effects.reset();
    chase.snap();
    syncPrev();
  });
  syncPrev();
}

// largada: sem colisao todos saem do mesmo ponto (fantasmas, justo como no TM);
// com colisao, grid em duas colunas.
function gridSlot(index, collisions) {
  const start = track.config.startDistance;
  if (!collisions) return { s: start - 6, u: 0 };
  const row = Math.floor(index / 2);
  const col = index % 2;
  return { s: start - 8 - row * 9, u: (col === 0 ? 1 : -1) * Math.min(3.6, track.halfWidth * 0.45) };
}

// ---------- modos ----------
function showMenu(error) {
  mode = 'menu';
  mpRacing = false;
  spectateId = null;
  remote.clear();
  menu.resetResults();
  menu.showPause(false);
  hud.setVisible(false);
  hud.setBoard([]);
  hud.setSpectating('');
  setOwnColor(0);
  loadWorld(menu.soloTrack);
  setupRace({});
  carModel.group.visible = true;
  menu.show('main');
  if (error) menu.setError(error);
  updateBestText();
  if (location.search.includes('sala=')) history.replaceState(null, '', location.pathname);
}

function updateBestText() {
  menu.setBest(race.best ? `Seu recorde nesta pista: ${formatTime(race.best.time)}` : '');
}

function startSolo() {
  audio.start();
  leaveSession();
  mode = 'solo';
  loadWorld(menu.soloTrack);
  setOwnColor(0);
  remote.clear();
  setupRace({});
  carModel.group.visible = true;
  menu.hide();
  menu.resetResults();
  hud.setVisible(true);
  hud.setBoard([]);
  hud.setSpectating('');
  hud.showHelp(false);
}

function leaveSession() {
  if (spectateTimer) clearTimeout(spectateTimer);
  if (!session) return;
  const s = session;
  session = null;
  s.leave();
}

async function createRoom({ settings, code }) {
  if (!menu.requireNick()) return;
  audio.start();
  const token = ++joinToken;
  menu.busy(code ? `Criando sala ${code}...` : 'Criando sala...');
  try {
    const s = await RoomSession.host({ name: menu.nick, settings, code });
    if (token !== joinToken) return s.leave();
    attachSession(s);
  } catch (err) {
    if (token !== joinToken) return;
    menu.show('create');
    menu.setError(err.message || String(err));
  }
}

async function joinRoom(code) {
  if (!menu.requireNick()) return;
  code = String(code || '').trim();
  if (!code) {
    menu.setError('Digite o codigo da sala');
    return;
  }
  audio.start();
  const token = ++joinToken;
  menu.busy('Conectando...');
  try {
    const s = await RoomSession.join({ name: menu.nick, code, onStatus: (t) => token === joinToken && menu.busyText(t) });
    if (token !== joinToken) return s.leave();
    attachSession(s);
  } catch (err) {
    if (token !== joinToken) return;
    menu.show('join');
    menu.setJoinCode(code);
    menu.setError(err.message || String(err));
  }
}

function attachSession(s) {
  leaveSession();
  session = s;
  mode = 'mp';
  loadWorld(s.settings.track);
  remote.setGhost(!s.settings.collisions);
  remote.clear();
  setOwnColor(s.self?.color ?? 0);

  s.on('roster', () => session === s && onRoster());
  s.on('start', (r) => session === s && onRaceStart(r));
  s.on('results', (res) => session === s && onResults(res));
  s.on('phase', (ph) => session === s && ph === 'lobby' && showLobby());
  s.on('state', (id, st) => {
    if (session !== s || id === s.selfId) return;
    const p = s.players.get(id);
    if (p && p.status === 'racing') remote.push(id, st, p);
  });
  s.on('left', (id) => remote.remove(id));
  s.on('toast', (t) => hud.toast(t, 2.5));
  s.on('closed', (reason) => {
    if (session !== s) return;
    session = null;
    showMenu(reason || 'Voce saiu da sala');
  });

  if (s.phase === 'racing') {
    // entrou com a corrida em andamento: assiste
    menu.hide();
    mpRacing = false;
    hud.setVisible(true);
    startSpectating();
    hud.toast('Corrida em andamento: voce corre na proxima. ← → troca o piloto', 4);
  } else if (s.phase === 'results' && s.results) {
    showLobby();
    onResults(s.results);
  } else {
    showLobby();
  }
}

function showLobby() {
  if (!session) return;
  mode = 'mp';
  mpRacing = false;
  spectateId = null;
  remote.clear();
  menu.resetResults();
  menu.showPause(false);
  hud.setVisible(false);
  hud.setSpectating('');
  const idx = session.playerList().findIndex((p) => p.id === session.selfId);
  const g = gridSlot(Math.max(0, idx), session.settings.collisions);
  setupRace({ gridS: g.s, gridU: g.u, records: false });
  carModel.group.visible = true;
  menu.show('lobby');
  menu.renderLobby(session);
}

function onRoster() {
  const s = session;
  if (!s) return;
  if (menu.current === 'lobby') menu.renderLobby(s);
  if (s.self && s.self.color !== ownColor && !mpRacing) setOwnColor(s.self.color);
  remote.retain((id) => s.players.get(id)?.status === 'racing');
  if (menu.resultsVisible && s.phase === 'racing') showLiveResults();
}

let boardRows = null;
let boardAcc = 0;

function onRaceStart(info) {
  const s = session;
  boardRows = null;
  menu.resetResults();
  menu.hide();
  menu.showPause(false);
  remote.clear();
  if (spectateTimer) clearTimeout(spectateTimer);
  const st = info.settings;
  remote.setGhost(!st.collisions);
  const idx = info.grid.indexOf(s.selfId);
  hud.setVisible(true);
  hud.setSpectating('');
  audio.start();
  if (idx >= 0) {
    const g = gridSlot(idx, st.collisions);
    setupRace({ laps: st.laps, fuel: st.fuel, gridS: g.s, gridU: g.u, records: false });
    race.restart(Math.max(0.5, (info.goAt - s.now()) / 1000));
    mpRacing = true;
    spectateId = null;
    ghostTime = 0;
    stateAcc = 0;
    carModel.group.visible = true;
    chase.snap();
  } else {
    mpRacing = false;
    startSpectating();
  }
}

function onLocalRaceOver(text) {
  if (mode !== 'mp') return;
  hud.toast(text, 3);
  if (spectateTimer) clearTimeout(spectateTimer);
  spectateTimer = setTimeout(() => {
    spectateTimer = null;
    if (!session || session.phase !== 'racing') return;
    startSpectating();
    showLiveResults();
  }, 2500);
}

function onResults(results) {
  const s = session;
  mpRacing = false;
  spectateId = null;
  hud.setSpectating('');
  hud.setVisible(false);
  remote.clear();
  // carro volta para o grid enquanto o resultado aparece
  const idx = s.playerList().findIndex((p) => p.id === s.selfId);
  const g = gridSlot(Math.max(0, idx), s.settings.collisions);
  setupRace({ gridS: g.s, gridU: g.u, records: false });
  carModel.group.visible = true;
  menu.hide();
  menu.resetResults();
  const winner = results.find((r) => r.status === 'finished');
  menu.showResults(results, {
    final: true,
    isHost: s.isHost,
    selfId: s.selfId,
    laps: s.settings.laps,
    note: s.isHost
      ? '★ = volta mais rapida da corrida. Clique em "Nova corrida" para voltar ao lobby.'
      : `★ = volta mais rapida da corrida. ${winner ? `Vencedor: ${winner.name}. ` : ''}Aguardando o master...`,
  });
}

// ---------- classificacao ao vivo ----------
function liveRows() {
  const s = session;
  if (!s) return [];
  const list = [...s.players.values()].filter((p) => p.status === 'racing' || p.status === 'finished' || p.status === 'dnf');
  const prog = (p) => (p.id === s.selfId && mpRacing ? race.progress : p.progress || 0);
  const fin = list.filter((p) => p.status === 'finished').sort((a, b) => a.totalTime - b.totalTime);
  const run = list.filter((p) => p.status === 'racing').sort((a, b) => prog(b) - prog(a));
  const out = list.filter((p) => p.status === 'dnf');
  let fastest = null;
  for (const p of list) if (p.bestLap != null && (fastest == null || p.bestLap < fastest)) fastest = p.bestLap;
  const lead = fin[0]?.totalTime;
  return [...fin, ...run, ...out].map((p) => ({
    ...p,
    gap: p.status === 'finished' && lead != null ? p.totalTime - lead : null,
    fastestLap: p.bestLap != null && p.bestLap === fastest,
  }));
}

function showLiveResults() {
  const s = session;
  if (!s || s.phase !== 'racing') return;
  const rows = liveRows();
  const running = rows.filter((r) => r.status === 'racing').length;
  menu.showResults(rows, {
    final: false,
    isHost: s.isHost,
    selfId: s.selfId,
    laps: s.settings.laps,
    note: running ? `${running} ainda correndo. Quem ficar sem combustivel e desclassificado.` : '',
  });
}

// ---------- espectador ----------
function spectateCandidates() {
  return liveRows()
    .filter((r) => r.status === 'racing' && r.id !== session.selfId && remote.get(r.id)?.visible)
    .map((r) => r.id);
}

function startSpectating() {
  spectateId = null;
  chase.snap();
}

function cycleSpectate(dir) {
  const list = spectateCandidates();
  if (!list.length) return;
  const i = list.indexOf(spectateId);
  spectateId = list[(i + dir + list.length) % list.length];
  chase.snap();
}

// ---------- estado enviado pela rede ----------
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
function makeState() {
  let f = 0;
  if (car.input.brake > 0.1 && !car.reverseMode) f |= F_BRAKE;
  if (car.turboTime > 0) f |= F_TURBO;
  if (ghostTime > 0) f |= F_GHOST;
  if (car.anySliding) f |= F_SLIDE;
  if (car.grounded) f |= F_GROUND;
  if (car.reverseMode) f |= F_REVERSE;
  const q = car.quat;
  return {
    t: 'st',
    n: ++stateSeq,
    h: Math.round(session.now() * 10) / 10,
    p: [r2(car.pos[0]), r2(car.pos[1]), r2(car.pos[2])],
    q: [r4(q.x), r4(q.y), r4(q.z), r4(q.w)],
    v: [r2(car.vel[0]), r2(car.vel[1]), r2(car.vel[2])],
    s: r4(car.visualSteerAngle),
    k: r2(car.localVel[2]),
    a: r2(car.input.gas),
    f,
    g: Math.round(race.progress * 10) / 10,
    rt: Math.round(race.raceTime * 1000) / 1000,
    l: race.lap,
    c: race.nextCp,
  };
}

// ---------- menu / acoes ----------
menu.on('solo', startSolo);
menu.on('soloTrack', () => {
  if (mode === 'menu') {
    loadWorld(menu.soloTrack);
    updateBestText();
  }
});
menu.on('create', createRoom);
menu.on('quality', (pref) => {
  qualityPref = pref;
  storeQualityPref(pref);
  const next = resolveQuality(pref);
  if (next.antialias !== quality.antialias) {
    // o antialias e fixo no contexto WebGL: recarrega (nick e pista ficam salvos)
    location.reload();
    return;
  }
  quality = next;
  applyCarStyle();
  applyRenderMode();
  if (mode === 'menu') {
    loadWorld(menu.soloTrack, true);
    // carro novo: material simples ou completo, compilado com o estado de sombra atual
    const c = ownColor;
    ownColor = -1;
    setOwnColor(c);
    updateBestText();
  }
});
menu.on('join', joinRoom);
menu.on('cancel', () => {
  joinToken++;
  menu.show('main');
});
menu.on('start', () => session?.isHost && session.startRace());
menu.on('leave', () => {
  leaveSession();
  showMenu();
});
menu.on('kick', (id) => session?.kick(id));
menu.on('again', () => session?.isHost && session.backToLobby());
menu.on('resume', () => menu.showPause(false));
menu.on('showResults', () => {
  menu.showPause(false);
  menu.resultsDismissed = false;
  if (session?.phase === 'racing') showLiveResults();
  else if (session?.results) onResults(session.results);
});
menu.on('endRace', () => {
  menu.showPause(false);
  session?.endRace();
});
menu.on('quit', () => {
  leaveSession();
  showMenu();
});

let roomPoll = null;
menu.on('joinScreen', () => {
  const poll = async () => {
    if (menu.current !== 'join') {
      clearInterval(roomPoll);
      roomPoll = null;
      return;
    }
    menu.renderRooms(await listRooms());
  };
  if (!roomPoll) roomPoll = setInterval(poll, 2000);
  poll();
});

input.onAction('any', () => audio.start());
input.onAction('respawn', () => {
  if (!isDriving()) return;
  race.respawn();
  if (mode === 'mp' && session?.settings.collisions) ghostTime = RESPAWN_GHOST;
});
input.onAction('restart', () => {
  if (mode === 'solo' && !menu.pauseVisible) race.restart();
  else if (mode === 'mp' && isDriving()) hud.toast('Reiniciar nao existe no multiplayer: use Enter para o checkpoint');
});
input.onAction('camera', () => {
  if (mode === 'menu') return;
  chase.nextMode();
  hud.toast(`Camera: ${chase.modeName}`);
});
let userMuted = false;
input.onAction('mute', () => {
  userMuted = audio.toggleMute();
  hud.toast(userMuted ? 'Som desligado' : 'Som ligado');
});
input.onAction('help', () => mode !== 'menu' && hud.showHelp());

// contador de fps pequeno no canto (tecla F esconde/mostra; fica salvo)
const FPS_KEY = 'stadium-rush.showFps';
const fpsEl = document.createElement('div');
fpsEl.id = 'fps';
fpsEl.className = 'fps';
let showFps = true;
try {
  showFps = localStorage.getItem(FPS_KEY) !== '0';
} catch {
  /* sem armazenamento */
}
fpsEl.classList.toggle('hidden', !showFps);
document.body.appendChild(fpsEl);
let fpsAcc = 0;
let fpsFrames = 0;
input.onAction('fps', () => {
  showFps = !showFps;
  fpsEl.classList.toggle('hidden', !showFps);
  try {
    localStorage.setItem(FPS_KEY, showFps ? '1' : '0');
  } catch {
    /* sem armazenamento */
  }
});
let fpsWorst = 0;
// media e minimo (pior quadro) a cada 0,5 s: minimo bem abaixo da media = engasgo
function updateFps(dt) {
  fpsAcc += dt;
  fpsFrames++;
  if (dt > fpsWorst) fpsWorst = dt;
  if (fpsAcc < 0.5) return;
  if (showFps) fpsEl.textContent = `${Math.round(fpsFrames / fpsAcc)} FPS · min ${Math.round(1 / Math.max(fpsWorst, 1e-3))}`;
  fpsAcc = 0;
  fpsFrames = 0;
  fpsWorst = 0;
}
input.onAction('menu', () => {
  if (mode === 'menu' || menu.visible) return;
  menu.showPause(!menu.pauseVisible, { mp: mode === 'mp', host: !!session?.isHost, racing: session?.phase === 'racing' });
});
input.onAction('left', () => mode === 'mp' && carHidden() && cycleSpectate(-1));
input.onAction('right', () => mode === 'mp' && carHidden() && cycleSpectate(1));

// ---------- interpolacao do estado fisico para render suave ----------
const prevPos = new THREE.Vector3();
const prevQuat = new THREE.Quaternion();
const curPos = new THREE.Vector3();
const curQuat = new THREE.Quaternion();
const renderPos = new THREE.Vector3();
const renderQuat = new THREE.Quaternion();
function syncPrev() {
  if (!car) return;
  prevPos.set(car.pos[0], car.pos[1], car.pos[2]);
  prevQuat.set(car.quat.x, car.quat.y, car.quat.z, car.quat.w);
}

// ---------- booster ----------
const _p = {};
function checkBoosters() {
  if (!car.grounded) return;
  const p = track.project(car.pos[0], car.pos[2], _p);
  if (!p) return;
  for (const b of world.trackMesh.boosters) {
    const d = p.s - b.s;
    if (d >= 0 && d <= b.length && Math.abs(p.u) <= b.halfWidth + 0.6) {
      if (car.turboTime < car.tun.turboDuration - 0.05) car.activateTurbo();
    }
  }
}

// ---------- laco principal ----------
let acc = 0;
let last = performance.now();
let time = 0;
let stuckTime = 0;
const wheelState = { steerAngle: 0, wheelSpin: [0, 0, 0, 0], suspension: [0, 0, 0, 0], braking: false, speedKmh: 0, boost: 0, dt: 0 };
const focusPos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const idleCar = { speed: 0, vel: [0, 0, 0], localVel: [0, 0, 0], grounded: true, turboTime: 0, wallHit: 0, anySliding: false, reverseMode: false, input: { gas: 0, brake: 0 }, wheels: [], tun: { turboDuration: 1.2 } };

function orbit(target, t) {
  const a = t * 0.25;
  camera.position.set(target.x + Math.sin(a) * 9, target.y + 2.6, target.z + Math.cos(a) * 9);
  camera.lookAt(target.x, target.y + 0.3, target.z);
  if (camera.fov !== 70) {
    camera.fov = 70;
    camera.updateProjectionMatrix();
  }
  chase.snap();
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!quality.retro) dynRes.update(dt);
  updateFps(dt);
  // o timestamp do rAF pode ser anterior ao ultimo quadro; aba em segundo plano gera saltos grandes
  dt = Math.min(0.1, Math.max(0, dt));
  time += dt;

  const driving = isDriving();
  const hidden = carHidden();
  const raceStepOn = mode === 'solo' || (mode === 'mp' && mpRacing);
  const physicsOn = !(mode === 'solo' && menu.pauseVisible) && !hidden;
  const collisions = mode === 'mp' && mpRacing && session?.settings.collisions;
  const hostNow = session ? session.now() : 0;

  // entrada
  const inp = input.read();
  const locked = !driving || race.controlsLocked;
  car.input.gas = locked ? 0 : inp.gas;
  car.input.brake = locked ? 0 : inp.brake;
  car.input.steer = locked ? 0 : inp.steer;
  car.input.analogSteer = inp.analog;

  // fisica em passo fixo de 100 Hz
  let wallHit = 0;
  if (physicsOn) {
    acc += dt;
    let steps = 0;
    while (acc >= PHYSICS_DT && steps < 12) {
      syncPrev();
      car.step(PHYSICS_DT);
      if (collisions && !race.controlsLocked) collideCar(car, remote, hostNow + steps * PHYSICS_DT * 1000, ghostTime > 0);
      wallHit = Math.max(wallHit, car.wallHit);
      if (raceStepOn) race.step(PHYSICS_DT);
      checkBoosters();
      acc -= PHYSICS_DT;
      steps++;
    }
    if (steps >= 12) acc = 0;
  } else {
    acc = 0;
  }
  car.wallHit = wallHit;
  if (ghostTime > 0) ghostTime = Math.max(0, ghostTime - dt);

  if (driving && !race.controlsLocked) {
    if (car.pos[1] < -30) race.respawn();
    // caiu no vao de um salto: volta ao checkpoint
    const pg = track.project(car.pos[0], car.pos[2], _p);
    const gap = pg && track.inGap(pg.s);
    if (gap) {
      const low = Math.min(gap.lipY, gap.landY);
      if (car.pos[1] < low - 3 || (car.grounded && car.pos[1] < low - 1)) {
        hud.toast('Caiu! Voltando ao checkpoint', 1.5);
        race.respawn();
      }
    }
    // carro capotado/parado: lembrar do respawn
    if (car.R[4] < 0.2 || (car.speed < 1 && !car.grounded)) {
      stuckTime += dt;
      if (stuckTime > 1.5) {
        hud.toast('Pressione Enter para voltar ao checkpoint', 2);
        stuckTime = -2;
      }
    } else if (stuckTime > 0) stuckTime = 0;
    // alerta de combustivel
    if (race.fuelMax > 0 && race.state === 'racing' && race.fuel < 3.5) {
      const sec = Math.ceil(race.fuel);
      if (sec < lastFuelBeep) {
        lastFuelBeep = sec;
        audio.playCountdown(false);
      }
    }
  }

  // estado do meu carro para os outros
  if (mode === 'mp' && mpRacing && session && !race.finished) {
    stateAcc += dt;
    if (stateAcc >= 1 / STATE_RATE) {
      stateAcc = Math.min(stateAcc - 1 / STATE_RATE, 1 / STATE_RATE);
      session.sendState(makeState());
    }
  }

  // estado interpolado para render
  const alpha = Math.min(1, Math.max(0, acc / PHYSICS_DT));
  curPos.set(car.pos[0], car.pos[1], car.pos[2]);
  curQuat.set(car.quat.x, car.quat.y, car.quat.z, car.quat.w);
  renderPos.lerpVectors(prevPos, curPos, alpha);
  renderQuat.slerpQuaternions(prevQuat, curQuat, alpha);
  carModel.group.visible = !hidden;
  carModel.group.position.copy(renderPos);
  carModel.group.quaternion.copy(renderQuat);

  wheelState.steerAngle = car.visualSteerAngle;
  for (let i = 0; i < 4; i++) {
    wheelState.wheelSpin[i] = car.wheels[i].spin;
    wheelState.suspension[i] = car.wheels[i].offset;
  }
  wheelState.braking = car.input.brake > 0.1 && !car.reverseMode;
  wheelState.speedKmh = car.localVel[2] * 3.6;
  wheelState.boost = car.turboTime > 0 ? Math.min(1, car.turboTime / car.tun.turboDuration + 0.3) : 0;
  wheelState.dt = dt;
  wheelState.grounded = car.grounded;
  carModel.update(wheelState);

  // carros dos outros
  remote.update(dt, hostNow);

  // camera / alvo
  let target = null; // carro remoto assistido
  if (hidden) {
    let rc = spectateId ? remote.get(spectateId) : null;
    if (!rc || !rc.visible || session.players.get(spectateId)?.status !== 'racing') {
      const list = spectateCandidates();
      spectateId = list[0] || null;
      rc = spectateId ? remote.get(spectateId) : null;
      if (rc) chase.snap();
    }
    target = rc && rc.visible ? rc : null;
  }

  if (target) {
    chase.update(dt, target.pos, target.quat, target.pseudo);
    focusPos.copy(target.pos);
  } else if (driving || (mode === 'solo' && menu.pauseVisible)) {
    chase.update(dt, renderPos, renderQuat, car);
    focusPos.copy(renderPos);
  } else if (hidden) {
    const f = track.frameAt(track.config.startDistance);
    focusPos.set(f.x, f.y + 0.5, f.z);
    orbit(focusPos, time);
  } else {
    focusPos.copy(renderPos);
    orbit(renderPos, time);
  }

  camera.updateMatrixWorld();
  remote.updateTags(camera);
  if (!hidden) world.effects.update(car, dt);
  audio.update(target ? target.pseudo : hidden ? idleCar : car, dt);
  world.trackMesh.update(time, target ? target.latest?.c ?? 0 : race.nextCp);
  world.env.update(focusPos, dt);

  // HUD
  if (mode === 'solo') {
    hud.update(dt, race, car);
  } else if (mode === 'mp' && session && session.phase === 'racing') {
    // classificacao a 10 Hz (antes era montada e comparada a cada quadro)
    const laps = session.settings.laps;
    boardAcc += dt;
    if (!boardRows || boardAcc >= 0.1) {
      boardAcc = 0;
      boardRows = liveRows();
      hud.setBoard(boardRows.map((r) => ({ name: r.name, css: PLAYER_COLORS[r.color % PLAYER_COLORS.length].css, info: statusText(r, laps).replace('Volta ', 'V'), self: r.id === session.selfId, out: r.status === 'dnf' })));
    }
    const rows = boardRows;
    const others = [];
    for (const rc of remote.cars.values()) if (rc.visible) others.push({ x: rc.pos.x, z: rc.pos.z, css: PLAYER_COLORS[rc.colorIndex % PLAYER_COLORS.length].css });
    const elapsed = Math.max(0, (hostNow - (session.race?.goAt || hostNow)) / 1000);
    if (target) {
      const pi = rows.findIndex((r) => r.id === spectateId);
      _fwd.set(0, 0, 1).applyQuaternion(target.quat);
      hud.update(dt, race, target.pseudo, {
        laps, timer: target.latest.rt || elapsed, lap: target.latest.l, nextCp: target.latest.c, fuel: null, fuelMax: 0,
        position: pi + 1, total: rows.length, others, focus: { x: target.pos.x, z: target.pos.z, fx: _fwd.x, fz: _fwd.z },
        bestLap: session.players.get(spectateId)?.bestLap, lastLap: null,
      });
      hud.setSpectating(`ASSISTINDO: ${target.name}   ← →`);
    } else if (hidden) {
      hud.update(dt, race, idleCar, { laps, timer: elapsed, lap: 1, nextCp: 0, fuel: null, fuelMax: 0, others, focus: null });
      hud.setSpectating(rows.some((r) => r.status === 'racing') ? 'Aguardando os pilotos...' : 'Fim da corrida');
    } else {
      const pi = rows.findIndex((r) => r.id === session.selfId);
      hud.update(dt, race, car, {
        laps, timer: race.state === 'countdown' ? 0 : race.raceTime, lap: race.lap, nextCp: race.nextCp,
        fuel: race.state === 'countdown' ? race.fuelMax : race.fuel, fuelMax: race.fuelMax,
        position: pi + 1, total: rows.length, others, bestLap: race.bestLap, lastLap: race.lastLap,
      });
      hud.setSpectating('');
    }
    if (menu.resultsVisible && !menu.pauseVisible && (time * 2) % 1 < dt * 2) showLiveResults();
  }

  renderFrame();
}

// ---------- inicio ----------
{
  const code = new URLSearchParams(location.search).get('sala');
  loadWorld(menu.soloTrack);
  showMenu();
  if (code) {
    // link de convite: abre a tela de entrar com o codigo preenchido
    menu.setJoinCode(code);
    if (menu.nick) menu.show('join');
    else menu.setError(`Escolha um nickname e clique em "Entrar em sala" (sala ${menu.joinCode})`);
  }
}
requestAnimationFrame(frame);

// acesso para depuracao pelo console do navegador
window.__game = {
  get car() { return car; },
  get race() { return race; },
  get track() { return track; },
  get chase() { return chase; },
  get carModel() { return carModel; },
  get session() { return session; },
  get remote() { return remote; },
  get mode() { return mode; },
  get renderer() { return renderer; },
  get world() { return world; },
  get camera() { return camera; },
  get quality() { return quality; },
  get dynRes() { return dynRes; },
  get retroPipe() { return retroPipe; },
  menu,
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (quality.retro) applyRenderMode();
});

document.addEventListener('visibilitychange', () => {
  audio.setMuted(document.hidden || userMuted);
});

window.addEventListener('beforeunload', () => leaveSession());

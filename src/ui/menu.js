// Menus em DOM: tela inicial, criar/entrar em sala, lobby, resultado e pausa.
import { TRACKS, DEFAULT_TRACK, getTrackDef } from '../track/tracks.js';
import { PLAYER_COLORS } from '../net/session.js';
import { formatTime, formatDiff } from '../game/race.js';

const $ = (id) => document.getElementById(id);
const NICK_KEY = 'stadium-rush.nick';
const SOLO_TRACK_KEY = 'stadium-rush.soloTrack';
const ROOM_OPTS_KEY = 'stadium-rush.roomOptions';

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento */
  }
}
function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function settingsText(s) {
  return [
    `${s.laps} ${s.laps === 1 ? 'volta' : 'voltas'}`,
    s.collisions ? 'Com colisao' : 'Sem colisao',
    s.fuel > 0 ? `Combustivel ${s.fuel} s` : 'Sem combustivel',
    getTrackDef(s.track).name,
  ];
}

export function statusText(r, laps) {
  if (r.status === 'finished') return formatTime(r.totalTime);
  if (r.status === 'racing') return `Volta ${Math.min(r.lap || 1, laps)}/${laps}`;
  if (r.status === 'dnf') {
    if (r.dnfReason === 'fuel') return 'Sem combustivel';
    if (r.dnfReason === 'left') return 'Saiu';
    return 'Nao terminou';
  }
  return '';
}

export class Menu {
  constructor() {
    this.root = $('menu');
    this.screens = [...this.root.querySelectorAll('.screen')];
    this.cb = {};
    this.current = 'main';

    // opcoes
    const laps = $('opt-laps');
    for (let i = 1; i <= 10; i++) laps.appendChild(new Option(`${i} ${i === 1 ? 'volta' : 'voltas'}`, String(i)));
    for (const sel of [$('opt-track'), $('solo-track')]) {
      for (const t of Object.values(TRACKS)) sel.appendChild(new Option(t.name, t.id));
    }
    let saved = {};
    try {
      saved = JSON.parse(load(ROOM_OPTS_KEY) || '{}') || {};
    } catch {
      saved = {};
    }
    laps.value = String(saved.laps || 3);
    $('opt-collisions').value = saved.collisions ? '1' : '0';
    $('opt-fuel').value = String(saved.fuel ?? 20);
    if (!$('opt-fuel').value) $('opt-fuel').value = '20';
    $('opt-track').value = TRACKS[saved.track] ? saved.track : DEFAULT_TRACK;
    const soloTrack = load(SOLO_TRACK_KEY);
    $('solo-track').value = TRACKS[soloTrack] ? soloTrack : DEFAULT_TRACK;
    $('solo-track').addEventListener('change', () => {
      store(SOLO_TRACK_KEY, $('solo-track').value);
      this.fire('soloTrack', $('solo-track').value);
    });

    const nick = $('nick');
    nick.value = load(NICK_KEY) || '';
    nick.addEventListener('input', () => store(NICK_KEY, nick.value.trim()));

    // botoes
    $('btn-solo').onclick = () => this.fire('solo');
    $('btn-create').onclick = () => this.requireNick() && this.show('create');
    $('btn-join').onclick = () => this.requireNick() && this.show('join');
    $('btn-create-go').onclick = () => {
      const s = this.createSettings();
      store(ROOM_OPTS_KEY, JSON.stringify(s));
      this.fire('create', s);
    };
    $('btn-join-go').onclick = () => this.fire('join', $('join-code').value);
    $('join-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.fire('join', $('join-code').value);
    });
    $('join-code').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    for (const b of this.root.querySelectorAll('[data-back]')) b.onclick = () => this.show('main');
    $('btn-busy-cancel').onclick = () => this.fire('cancel');
    $('btn-start').onclick = () => this.fire('start');
    $('btn-leave').onclick = () => this.fire('leave');

    $('btn-again').onclick = () => this.fire('again');
    $('btn-results-hide').onclick = () => this.hideResults(true);
    $('btn-results-leave').onclick = () => this.fire('leave');

    $('btn-resume').onclick = () => this.fire('resume');
    $('btn-show-results').onclick = () => this.fire('showResults');
    $('btn-end-race').onclick = () => this.fire('endRace');
    $('btn-quit').onclick = () => this.fire('quit');
    this.show('main');
  }

  on(name, fn) {
    this.cb[name] = fn;
  }
  fire(name, arg) {
    this.setError('');
    this.cb[name]?.(arg);
  }

  get nick() {
    return $('nick').value.trim();
  }
  get soloTrack() {
    return $('solo-track').value;
  }

  get joinCode() {
    return $('join-code').value;
  }

  requireNick() {
    if (this.nick) return true;
    if (this.current !== 'main') this.show('main');
    this.setError('Escolha um nickname antes');
    $('nick').focus();
    return false;
  }

  createSettings() {
    return {
      laps: Number($('opt-laps').value),
      collisions: $('opt-collisions').value === '1',
      fuel: Number($('opt-fuel').value),
      track: $('opt-track').value,
    };
  }

  show(screen) {
    this.current = screen;
    this.root.classList.remove('hidden');
    for (const s of this.screens) s.classList.toggle('active', s.dataset.screen === screen);
    if (screen === 'join') this.fire('joinScreen');
    if (screen === 'main') setTimeout(() => !this.nick && $('nick').focus(), 50);
  }
  hide() {
    this.root.classList.add('hidden');
    this.current = null;
  }
  get visible() {
    return !this.root.classList.contains('hidden');
  }

  setError(msg) {
    $('menu-error').textContent = msg || '';
  }
  busy(text) {
    this.show('busy');
    $('busy-text').textContent = text;
  }
  busyText(text) {
    $('busy-text').textContent = text;
  }
  setJoinCode(code) {
    $('join-code').value = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  setBest(text) {
    $('best-start').textContent = text || '';
  }

  // lista de salas: null = sem servidor local
  renderRooms(list) {
    const box = $('room-list');
    box.replaceChildren();
    if (list == null) {
      box.appendChild(el('div', 'room-empty', 'Lista indisponivel sem o servidor local (npm run lan). Digite o codigo da sala.'));
      return;
    }
    if (!list.length) {
      box.appendChild(el('div', 'room-empty', 'Nenhuma sala aberta na rede ainda.'));
      return;
    }
    for (const r of list) {
      const item = el('div', 'room-item');
      item.appendChild(el('span', 'room-code', r.code));
      const phase = r.phase === 'racing' ? 'correndo (entra assistindo)' : r.phase === 'results' ? 'resultado' : 'no lobby';
      item.appendChild(el('span', 'room-info', `${r.host} · ${r.players}/${r.max} · ${r.laps} voltas · ${phase}`));
      const b = el('button', 'primary', 'Entrar');
      b.onclick = () => this.fire('join', r.code);
      item.appendChild(b);
      box.appendChild(item);
    }
  }

  renderLobby(session) {
    $('lobby-code').textContent = session.code;
    const link = `${location.origin}${location.pathname}?sala=${session.code}`;
    $('lobby-link').textContent = `Convite: ${link}`;
    const st = $('lobby-settings');
    st.replaceChildren(...settingsText(session.settings).map((t) => el('span', null, t)));
    const ul = $('lobby-players');
    ul.replaceChildren();
    for (const p of session.playerList()) {
      const li = el('li', p.id === session.selfId ? 'self' : '');
      const dot = el('span', 'dot');
      dot.style.background = PLAYER_COLORS[p.color % PLAYER_COLORS.length].css;
      li.append(dot, el('span', 'pname', p.name));
      if (p.id === 'host') li.appendChild(el('span', 'badge master', 'MASTER'));
      if (p.status === 'spectator') li.appendChild(el('span', 'badge', 'ASSISTINDO'));
      if (p.id === session.selfId) li.appendChild(el('span', 'badge', 'VOCE'));
      if (session.isHost && p.id !== 'host') {
        const k = el('button', 'kick', 'remover');
        k.onclick = () => this.fire('kick', p.id);
        li.appendChild(k);
      }
      ul.appendChild(li);
    }
    $('btn-start').style.display = session.isHost ? '' : 'none';
    $('btn-start').disabled = session.phase === 'racing';
    $('lobby-wait').style.display = session.isHost ? 'none' : '';
  }

  // rows: [{ id, name, color, status, totalTime, gap, bestLap, fastestLap, lap, dnfReason }]
  showResults(rows, { final, isHost, selfId, laps, note }) {
    const box = $('results');
    if (!final && this.resultsDismissed) return;
    box.classList.remove('hidden');
    box.classList.toggle('live', !final);
    $('results-title').textContent = final ? 'Resultado final' : 'Classificacao';
    const body = $('results-body');
    body.replaceChildren();
    rows.forEach((r, i) => {
      const tr = el('tr', `${r.id === selfId ? 'self' : ''} ${i === 0 && r.status === 'finished' ? 'p1' : ''}`);
      tr.appendChild(el('td', null, String(i + 1)));
      const name = el('td');
      const dot = el('span', 'dot');
      dot.style.background = PLAYER_COLORS[(r.color || 0) % PLAYER_COLORS.length].css;
      name.append(dot, document.createTextNode(r.name));
      tr.appendChild(name);
      const fin = r.status === 'finished';
      tr.appendChild(el('td', fin ? null : 'muted', statusText(r, laps)));
      tr.appendChild(el('td', 'muted', fin && r.gap != null && r.gap > 0 ? formatDiff(r.gap) : ''));
      tr.appendChild(el('td', r.fastestLap ? 'fl' : null, r.bestLap != null ? formatTime(r.bestLap) : '--'));
      body.appendChild(tr);
    });
    $('results-note').textContent = note || '';
    $('btn-again').style.display = final && isHost ? '' : 'none';
    $('btn-results-hide').style.display = final ? 'none' : '';
  }

  hideResults(dismiss = false) {
    if (dismiss) this.resultsDismissed = true;
    $('results').classList.add('hidden');
  }
  resetResults() {
    this.resultsDismissed = false;
    this.hideResults();
  }
  get resultsVisible() {
    return !$('results').classList.contains('hidden');
  }

  showPause(v, { mp = false, host = false, racing = false } = {}) {
    $('pause').classList.toggle('hidden', !v);
    $('btn-show-results').style.display = mp ? '' : 'none';
    $('btn-end-race').style.display = mp && host && racing ? '' : 'none';
    $('btn-quit').textContent = mp ? 'Sair da sala' : 'Sair para o menu';
  }
  get pauseVisible() {
    return !$('pause').classList.contains('hidden');
  }
}

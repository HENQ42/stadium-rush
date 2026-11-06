// Entrada: teclado + gamepad (API Gamepad, funciona em Chrome/Firefox/Edge).
const GAS_KEYS = ['ArrowUp', 'KeyW'];
const BRAKE_KEYS = ['ArrowDown', 'KeyS', 'Space'];
const LEFT_KEYS = ['ArrowLeft', 'KeyA'];
const RIGHT_KEYS = ['ArrowRight', 'KeyD'];

export class Input {
  constructor() {
    this.keys = new Set();
    this.actions = {}; // callbacks de acoes pontuais
    this.usingGamepad = false;
    this.prevButtons = [];
    const typing = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    };
    window.addEventListener('keydown', (e) => {
      // digitando o nickname/codigo da sala: nao vira comando do jogo
      if (typing(e)) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.fire(e.code);
      this.keys.add(e.code);
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onAction(name, fn) {
    this.actions[name] = fn;
  }

  fire(code) {
    const map = {
      Enter: 'respawn', NumpadEnter: 'respawn', Backspace: 'respawn',
      Delete: 'restart', KeyR: 'restart',
      KeyC: 'camera', KeyM: 'mute', KeyH: 'help', Escape: 'menu', KeyF: 'fps',
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    };
    const a = map[code];
    if (a && this.actions[a]) this.actions[a]();
    if (this.actions.any) this.actions.any();
  }

  any(list) {
    return list.some((k) => this.keys.has(k));
  }

  // Retorna { gas, brake, steer, analog }
  read() {
    let gas = this.any(GAS_KEYS) ? 1 : 0;
    let brake = this.any(BRAKE_KEYS) ? 1 : 0;
    let steer = (this.any(RIGHT_KEYS) ? 1 : 0) - (this.any(LEFT_KEYS) ? 1 : 0);
    let analog = false;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] || 0;
      const rt = gp.buttons[7]?.value || 0;
      const lt = gp.buttons[6]?.value || 0;
      const a = gp.buttons[0]?.pressed;
      const dz = 0.12;
      const stick = Math.abs(ax) > dz ? Math.sign(ax) * ((Math.abs(ax) - dz) / (1 - dz)) : 0;
      if (Math.abs(stick) > 0 || rt > 0.05 || lt > 0.05 || a) this.usingGamepad = true;
      if (this.usingGamepad) {
        gas = Math.max(gas, rt, a ? 1 : 0);
        brake = Math.max(brake, lt, gp.buttons[1]?.pressed ? 1 : 0);
        if (Math.abs(stick) > 0) {
          steer = stick;
          analog = true;
        }
      }
      // botoes de acao (borda de subida)
      const edges = [
        [3, 'respawn'], [9, 'restart'], [8, 'camera'], [2, 'respawn'],
      ];
      for (const [b, name] of edges) {
        const pressed = !!gp.buttons[b]?.pressed;
        const key = `${gp.index}:${b}`;
        if (pressed && !this.prevButtons[key] && this.actions[name]) this.actions[name]();
        if (pressed && this.actions.any) this.actions.any();
        this.prevButtons[key] = pressed;
      }
      break;
    }
    return { gas, brake, steer: Math.max(-1, Math.min(1, steer)), analog };
  }
}

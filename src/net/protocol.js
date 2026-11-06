// Constantes compartilhadas da rede (sem dependencias, usadas tambem em testes no node).
export const PLAYER_COLORS = [
  { body: 0x1e6bff, secondary: 0xff2a2a, accent: 0xffffff, css: '#2a7bff' },
  { body: 0xe8232a, secondary: 0xffd60a, accent: 0xffffff, css: '#ff3b3b' },
  { body: 0x18b84a, secondary: 0xffffff, accent: 0x111111, css: '#29d65c' },
  { body: 0xffc21a, secondary: 0x1a1a1a, accent: 0xffffff, css: '#ffcc22' },
  { body: 0xff7a12, secondary: 0x1e6bff, accent: 0xffffff, css: '#ff8a2a' },
  { body: 0x8e3dff, secondary: 0x2af0ff, accent: 0xffffff, css: '#a55cff' },
  { body: 0x12c8d8, secondary: 0xff2a8a, accent: 0xffffff, css: '#2fe0ee' },
  { body: 0xff4fb8, secondary: 0xffffff, accent: 0x1a1a1a, css: '#ff6cc6' },
];

// flags do estado
export const F_BRAKE = 1;
export const F_TURBO = 2;
export const F_GHOST = 4;
export const F_SLIDE = 8;
export const F_GROUND = 16;
export const F_REVERSE = 32;

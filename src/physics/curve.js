// Curva linear por partes, equivalente simplificado do CFuncKeysReal do jogo.
// Fora do intervalo o valor e mantido no primeiro/ultimo ponto.
export class Curve {
  constructor(keys) {
    this.x = keys.map((k) => k[0]);
    this.y = keys.map((k) => k[1]);
  }

  at(v) {
    const { x, y } = this;
    const n = x.length;
    if (v <= x[0]) return y[0];
    if (v >= x[n - 1]) return y[n - 1];
    let i = 1;
    while (x[i] < v) i++;
    const t = (v - x[i - 1]) / (x[i] - x[i - 1]);
    return y[i - 1] + (y[i] - y[i - 1]) * t;
  }
}

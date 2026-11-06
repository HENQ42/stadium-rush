// Definicao da pista. Cada ponto de controle: [x, z, y, bank]
// x/z em metros no plano, y = altura da pista, bank = intensidade da
// inclinacao lateral automatica nas curvas (0 = plana).
// A pista e uma spline Catmull-Rom fechada passando por esses pontos.
export const TRACK_POINTS = [
  [0, -220, 0, 0],
  [0, -60, 0, 0],
  [0, 100, 0, 0],
  // Curva longa a esquerda, inclinada (estilo Stadium)
  [15, 200, 0.5, 1],
  [70, 270, 1, 1],
  [160, 290, 1.5, 1],
  [235, 240, 1.5, 1],
  [255, 160, 2, 0.3],
  // Reta em subida com lombada (salto)
  [260, 60, 5, 0],
  [262, -20, 10, 0],
  [262, -50, 10, 0],
  [258, -110, 1.5, 0],
  // Chicane
  [230, -175, 0.5, 0.5],
  [185, -195, 0, 0.5],
  [150, -168, 0, 0.5],
  [110, -150, 0, 0.5],
  // Descida para o grampo
  [70, -230, 0, 0.6],
  [60, -320, 0, 0.6],
  [30, -380, 0, 1.2],
  [-20, -370, 0, 1.2],
  [-30, -320, 0, 0.6],
  [-10, -280, 0, 0.2],
];

export const TRACK_CONFIG = {
  halfWidth: 8, // pista de 16 m
  wallHeight: 1.1,
  wallThickness: 0.6,
  sampleSpacing: 2, // metros entre amostras da linha central
  maxBank: 0.42, // rad (~24 graus)
  bankGain: 24, // inclinacao = gain * curvatura
  startDistance: 40, // linha de largada (m a partir do primeiro ponto)
  // Checkpoints em metros ao longo da pista (fracoes do comprimento total)
  checkpointFractions: [0.25, 0.5, 0.75],
  // Boosters (turbo) em fracao do comprimento
  boosterFractions: [0.335],
  boosterLength: 10,
  // Saltos: rampa (curva quadratica, lip abrupto) seguida de um vao sem pista.
  // lipS = distancia do fim da rampa; arches = posicoes (m) dos arcos sobre o salto
  jumps: [
    { lipS: 250, rampLength: 45, rampHeight: 2.4, gap: 26, archRadius: 14, arches: [256, 272] },
    { lipS: 960, rampLength: 40, rampHeight: 0.9, gap: 22, archRadius: 21, arches: [971] },
  ],
  // Trechos de terra/barro (m ao longo da pista)
  dirt: [{ from: 1095, to: 1365 }],
  // Trechos de gramado (como a grama do Stadium: escorrega muito)
  grass: [{ from: 1385, to: 1560 }],
};

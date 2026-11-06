// Pista "Speedway": pista rapida para o multiplayer. Mesmo formato de
// trackData.js: cada ponto de controle e [x, z, y, bank].
// Retas longas, curvas grandes inclinadas (de pe no fundo), dois saltos com
// arcos, trecho de terra em S, gramado na reta longa e boosters.
export const SPEEDWAY_POINTS = [
  // reta principal (largada)
  [0, -300, 0, 0],
  [0, -60, 0, 0],
  [0, 200, 0, 0],
  // curva 1: 180 graus grande e inclinada, de pe no fundo
  [20, 330, 0.5, 2],
  [90, 420, 1.5, 2],
  [200, 445, 2.5, 2],
  [290, 390, 3, 2],
  [320, 280, 3, 0.8],
  // reta de volta em subida ate o salto com arcos, aterrissagem em descida
  [322, 150, 5, 0],
  [322, 40, 7, 0],
  [322, -60, 3, 0],
  // curva 2: sweeper rapido
  [340, -170, 1, 1.4],
  [410, -240, 0.5, 1.4],
  [520, -255, 0.5, 0.6],
  // curva 3 inclinada
  [610, -300, 0.5, 1.5],
  [640, -400, 0.5, 0.6],
  // S de terra
  [625, -500, 0, 0.5],
  [650, -600, 0, 0.5],
  // curva 4: a mais fechada da pista (freio + drift)
  [640, -690, 0.5, 1.5],
  [580, -740, 0.5, 1.5],
  [510, -720, 0.5, 0.6],
  // reta longa para oeste: gramado e segundo salto
  [400, -700, 4, 0],
  [200, -700, 4, 0],
  // curva final inclinada
  [60, -690, 0.5, 1.8],
  [-10, -620, 1, 1.8],
  [-15, -480, 0.5, 0.3],
];

export const SPEEDWAY_CONFIG = {
  halfWidth: 9, // pista de 18 m (cabe mais de um carro lado a lado)
  wallHeight: 1.1,
  wallThickness: 0.6,
  sampleSpacing: 2,
  maxBank: 0.42,
  bankGain: 24,
  startDistance: 120,
  checkpointFractions: [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6],
  // boosters: reta da largada, antes do salto 1 e na saida da curva 4
  boosterFractions: [190 / 3286, 1170 / 3286, 2425 / 3286],
  boosterLength: 10,
  // salto 1 (rapido, ~280 km/h) com tunel de 3 arcos; salto 2 baixo com arco largo
  jumps: [
    { lipS: 1300, rampLength: 50, rampHeight: 2.0, gap: 30, archRadius: 15, arches: [1308, 1324, 1340] },
    { lipS: 2600, rampLength: 40, rampHeight: 1.2, gap: 24, archRadius: 20, arches: [2614] },
  ],
  // S de terra depois da curva 3
  dirt: [{ from: 2000, to: 2190 }],
  // gramado no fim da reta longa, entrando na curva final
  grass: [{ from: 2660, to: 2800 }],
};

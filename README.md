# Stadium Rush

Jogo de corrida para navegador no estilo TrackMania Nations Forever (carro
Stadium, tipo Fórmula 1), solo ou multiplayer na rede local. Duas pistas:

- **Speedway (rápida, ~3,3 km):** reta de largada longa, curva de 180° grande
  e inclinada, salto a ~280 km/h por um túnel de 3 arcos, sweepers rápidos, S
  de terra, curva fechada inclinada, salto baixo com arco largo, gramado e 3
  boosters. Volta de ~45 s com piloto automático.
- **Clássica (~1,7 km):** a primeira pista, mais técnica.

Feito com [three.js](https://threejs.org/) + [Vite](https://vite.dev/). Roda em
Chrome, Edge, Firefox e Safari recentes (WebGL 2).

## Rodar

```bash
npm install
npm run lan        # compila e inicia o servidor da rede local (porta 8080)
```

Abra o endereço que aparece no terminal (ex.: `http://192.168.1.10:8080`) em
cada computador da rede. Outros comandos:

```bash
npm run dev        # desenvolvimento (http://localhost:5173); rode "npm run server" junto para o multiplayer
npm run dev:lan    # igual, mas acessível pela rede
npm run build      # gera a versão estática em dist/
npm run server     # só o servidor (usa dist/); a variável PORT muda a porta
```

A pasta `dist/` também funciona em hospedagem estática. Sem o servidor local, o
multiplayer usa o servidor público de sinalização do PeerJS (precisa de
internet), e não há lista de salas nem relay.

## Gráficos e desempenho

Na tela inicial, **Gráficos** tem Automática, Alta, Média e Baixa. A automática
escolhe pelo nome da GPU (Intel/AMD integrada = Média, Intel HD antiga ou
renderização por software = Baixa). O número de FPS fica no canto superior
direito (F esconde/mostra).

| | Alta | Média | Baixa |
|---|---|---|---|
| Antialias (MSAA) | sim | não | não |
| Resolução interna | até 150% | até 100% | 75% |
| Sombras | 2048 px, com árvores | 1024 px, sem árvores | não |
| Cenário | 100% | 70%, árvores distantes simplificadas | 45%, sem nuvens |

Em todos os modos a **resolução dinâmica** baixa a resolução interna (até 75%,
60% ou 50%) quando o jogo fica abaixo de 50 FPS e volta a subir quando passa de
58 FPS. Mudar entre Alta e as outras recarrega a página, porque o antialias é
fixo no contexto WebGL.

## Multiplayer

- Todo jogador escolhe um **nickname** (nomes repetidos ganham um número).
- O **master** cria a sala e define antes: número de **voltas** (1–10),
  **colisão** entre carros (sim/não), **combustível** por checkpoint e a pista.
  O master escolhe um **código de 4 letras** (ex.: `RUSH`) ou deixa em branco
  para sortear um, e passa o código para quem vai entrar em "Entrar em sala".
  Se o código já estiver em uso, o jogo pede outro.
  Com o servidor local, as salas abertas aparecem na tela "Entrar em sala".
- Os jogadores entram no lobby. O master clica em **Iniciar corrida** quando
  quiser, e todos largam juntos (contagem sincronizada pelo relógio do master).
  Sem colisão, todos saem do mesmo ponto como fantasmas. Com colisão, o grid é
  sorteado em duas colunas.
- Quem entra **depois da largada** assiste a corrida e corre na próxima.
  Assistindo, ← → troca o piloto seguido.
- **Combustível:** o tanque enche a cada checkpoint e na linha de chegada. Se
  acabar antes do próximo checkpoint, o piloto é desclassificado e passa a
  assistir. Assim ninguém fica esperando um piloto parado ou perdido. Voltar ao
  checkpoint (Enter) não reabastece.
- Quem termina vê a classificação ao vivo e assiste os outros. Quando todos
  terminam (ou são desclassificados), aparece o **resultado final**, ordenado
  pelo tempo total, com a diferença para o vencedor e a melhor volta de cada um
  (★ = volta mais rápida da corrida). O master também pode encerrar a corrida
  pelo menu (Esc) e depois clicar em "Nova corrida" para voltar ao lobby.

Como funciona a rede (`src/net/`):

- **WebRTC com PeerJS:** cada jogador abre uma conexão direta com o master
  (topologia em estrela), com dois canais: um confiável para eventos (entrada,
  largada, checkpoints, resultado) e um não ordenado para a posição dos carros,
  30 vezes por segundo, que o master repassa na hora para os outros.
- **WebSocket:** a sinalização do WebRTC passa pelo servidor PeerJS embutido em
  `server/server.mjs` (`/peerjs`). Se o WebRTC não conectar em 7 s, o jogo usa
  um relay WebSocket no mesmo servidor (`/relay`). Para forçar o relay, abra
  com `?net=ws`.
- Cada jogador simula o próprio carro (sem atraso no controle). Os outros carros
  são interpolados com 70 ms de atraso, e o relógio do master é sincronizado
  por ping/pong.
- Com colisão, cada jogador resolve o choque do próprio carro contra a posição
  prevista do outro, com metade do impulso (choque entre massas iguais). Depois
  de voltar ao checkpoint, o carro fica 2 s sem colisão.
- Até 8 jogadores por sala. Quem fica 20 s sem responder sai da sala.

## Controles

| Ação | Teclado | Gamepad |
|---|---|---|
| Acelerar | ↑ / W | RT ou A |
| Freio / ré | ↓ / S / Espaço | LT ou B |
| Direção | ← → / A D | analógico esquerdo |
| Voltar ao último checkpoint | Enter / Backspace | Y ou X |
| Reiniciar (solo) | Delete / R | Start |
| Trocar câmera | C | Back |
| Som | M | |
| Ajuda | H | |
| Menu / sair da sala | Esc | |
| Trocar piloto assistido | ← → | |

Dica: o carro não tem drift. O freio só freia, e o carro tem tração para
fazer curvas fechadas sem escorregar. Na terra e na grama ele escorrega mais.
Se cair no vão de um salto, o carro volta sozinho ao último checkpoint.

## Física

`src/physics/stadiumCar.js` segue a estrutura de
`CSceneVehicleCar::ComputeForcesModel6` reconstruída no
[TMNF-C](https://github.com/adonis-singh/TMNF-C) e no
[TMNationsDecomp](https://github.com/rockenrooster/TMNationsDecomp)
(`core/src/gameplay/vehicle.cpp`). Os valores vêm do tuning original do Stadium
`20juin2006`, como aparece em `tests/vehicle_simulation_test.cpp` desse projeto:

- gravidade 30 m/s² no chão e 25 no ar;
- inércia de uma caixa de 1×1×2 m com massa 5;
- curva de aceleração (16 m/s² parado, 11 a 100 km/h, 7 a 200 km/h);
- `sideFriction1` 40 e `steerGroundTorque` 0,08;
- raio de esterço `2 + 0,85·v` e torque inercial (transferência de peso) 0,05.

Do jogo foram mantidos:

- passo fixo de 100 Hz;
- força lateral por roda aplicada no centro de massa, com limite pela curva
  de atrito máximo e estado de escorregamento;
- giro (yaw) por torque separado: amortecimento lateral por eixo mais o torque
  de direção;
- latch de marcha à ré e arrasto linear e angular no ar.

O que não vem do jogo (tração alta, sem drift):

- **Freio simples:** só desacelera (como um ABS). No jogo o freio forte solta as
  rodas; aqui não.
- **Downforce:** o limite de atrito lateral sobe com a velocidade, como num F1
  (80 parado, 102 a 300 km/h, 115 a 500 km/h; no jogo cai de 80 para 55), e uma
  força para baixo de 0,0006·v² mantém as rodas carregadas nas curvas rápidas.
- **Curvas mais fechadas:** torque de direção maior em velocidade (8,4 a
  220 km/h, 7,2 a 300 e 5,3 a 500; no jogo 5,5, 4,25 e 3,75).
- **Pneu que escorrega segura 75%** (no jogo 35%): passou do limite, o carro
  escorrega um pouco e volta, sem rodar, como no pico suave da curva de Pacejka.
- **Círculo de atrito:** frear forte tira até 20% da aderência lateral.
- **Controle de estabilidade:** se o ângulo de deriva passar de ~3,4° (até ~8°
  com a direção toda), um torque alinha o carro com a velocidade. No Model 6
  puro, com o eixo saturado o carro roda de repente.
- **Terra e grama:** multiplicadores de aderência, aceleração e freio. O torque de
  direção também cai com a aderência, então o carro abre a curva em vez de rodar.
- **Rolagem limitada:** a transferência de peso lateral usa no máximo 45 m/s² de
  força, para o carro não tombar ao raspar o muro com tração alta.
- **Suspensão:** é de mola com raio (raycast), e a aderência cai com pouca carga na roda.
- **Muros:** não quicam e são escorregadios. Depois de encostar, o carro é
  alinhado com o muro por ~0,4 s, então uma batida leve quase não tira
  velocidade e não joga o carro para trás. Sobre o vão dos saltos o muro
  continua invisível, para o carro não escapar da pista voando.
- **Peso extra:** inércia de giro um pouco acima da do jogo, e direção (teclado)
  e acelerador com um leve atraso.

Referências usadas para a tração: o [círculo de atrito](https://pulsegeek.com/articles/vehicle-physics-fundamentals-for-games-core-concepts)
(frear e virar disputam a mesma aderência), o downforce e a curva de atrito
normalizada do [ArcadeCarPhysics](https://github.com/SergeyMakeev/ArcadeCarPhysics)
e a curva de Pacejka (aderência que sobe até um pico e cai devagar).

Números atuais (simulação sem renderização):

- 0–100 km/h em ~2,2 s, 0–200 km/h em ~6 s, 300 km/h em ~15 s, 400 km/h em ~35 s
  e 500 km/h em ~88 s (~9,6 km de reta);
- velocidade máxima de 550 km/h: acima de 100 km/h a aceleração cai até zero em 550
  (no plano o carro fica em ~526; no jogo o limite é 1000 km/h), e descidas ou
  turbo acima de 550 são freados;
- raio com a direção toda, sem escorregar: 11 m a 80 km/h, 20 m a 150, 35 m a
  220, 55 m a 300, 86 m a 400 e 123 m a 500 km/h (antes: 29 m a 150, 56 m a 220,
  93 m a 300);
- ângulo de deriva no asfalto abaixo de 1,5° em degrau de direção, zigue-zague e
  freio na curva, de 150 a 450 km/h;
- volta de ~32,4 s na Clássica e ~44,4 s na Speedway com o piloto automático
  conservador (o mesmo de antes); com um piloto mais agressivo, ~28,9 s e ~39,8 s.

## Estrutura

```
server/server.mjs       servidor da rede local (arquivos, PeerJS, relay, lista de salas)
src/
  main.js               laço do jogo, modos (menu/solo/multiplayer), passo fixo
  net/                  transporte (PeerJS + relay WebSocket) e protocolo da sala
  ui/menu.js            menus, lobby, resultado
  physics/              física do carro (Model 6) e curvas
  track/                pistas e consultas de chão/muro
  scene/                carro 3D, pista 3D, ambiente, efeitos de pneu
  audio/engineAudio.js  som sintetizado (motor, pneus, vento, batidas)
  game/                 corrida/tempos/combustível, entrada, câmera, HUD, carros remotos
```

As pistas ficam em `src/track/trackData.js` (Clássica) e
`src/track/speedwayData.js` (Speedway), registradas em `src/track/tracks.js`.
Ali também ficam os saltos (`jumps`: rampa, vão e arcos), os trechos de terra
(`dirt`) e de gramado (`grass`), checkpoints e boosters. A física, a malha e o
minimapa se ajustam sozinhos. O recorde de cada pista fica salvo no
`localStorage` do navegador.

// Malha visual da pista: asfalto, zebras, muros estilo Stadium, taludes de
// grama, portico de largada/chegada, checkpoints e booster.
import * as THREE from 'three';

const ROAD_LIFT = 0.025; // asfalto levemente acima do terreno (evita z-fighting)

function canvasTex(w, h, draw, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function noise(ctx, w, h, amount, alpha, rnd = Math.random) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
    d[i + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
}

// Textura do asfalto: cobre a largura toda (u 0..1) e 16 m em v.
function asphaltTexture() {
  return canvasTex(512, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#5a5d63';
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 38, 255);
    // manchas grandes sutis
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '30,30,34' : '120,122,128'},0.05)`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 60, 30 + Math.random() * 120, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // trilhas de pneu mais escuras/polidas
    for (const x of [0.3, 0.42, 0.58, 0.7]) {
      const g = ctx.createLinearGradient(x * w - 22, 0, x * w + 22, 0);
      g.addColorStop(0, 'rgba(25,25,28,0)');
      g.addColorStop(0.5, 'rgba(25,25,28,0.22)');
      g.addColorStop(1, 'rgba(25,25,28,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x * w - 22, 0, 44, h);
    }
    // faixas brancas laterais
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(w * 0.03, 0, w * 0.022, h);
    ctx.fillRect(w * (1 - 0.052), 0, w * 0.022, h);
    // faixa central tracejada
    ctx.fillStyle = 'rgba(240,240,240,0.85)';
    ctx.fillRect(w * 0.494, 0, w * 0.012, h * 0.45);
  });
}

// Textura de terra/barro (estilo Stadium Dirt): marrom com sulcos e pedrinhas.
function dirtTexture() {
  return canvasTex(512, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#8a5a32';
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 46, 255);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '70,40,20' : '170,120,75'},0.10)`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 70, 30 + Math.random() * 140, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // sulcos dos pneus
    for (const x of [0.28, 0.4, 0.6, 0.72]) {
      const g = ctx.createLinearGradient(x * w - 26, 0, x * w + 26, 0);
      g.addColorStop(0, 'rgba(60,34,16,0)');
      g.addColorStop(0.5, 'rgba(60,34,16,0.35)');
      g.addColorStop(1, 'rgba(60,34,16,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x * w - 26, 0, 52, h);
    }
    // pedrinhas
    for (let i = 0; i < 1400; i++) {
      const c = 120 + Math.random() * 80;
      ctx.fillStyle = `rgba(${c},${c * 0.85},${c * 0.7},0.55)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // bordas mais escuras (terra fofa)
    for (const [x0, x1] of [[0, 0.07], [0.93, 1]]) {
      ctx.fillStyle = 'rgba(80,48,24,0.45)';
      ctx.fillRect(x0 * w, 0, (x1 - x0) * w, h);
    }
  });
}

// Gramado de pista (estilo Stadium): grama aparada com faixas de corte.
function turfTexture() {
  return canvasTex(512, 1024, (ctx, w, h) => {
    const bands = 8;
    for (let i = 0; i < bands; i++) {
      ctx.fillStyle = i % 2 ? '#4f8f2e' : '#5ea236';
      ctx.fillRect(0, (i * h) / bands, w, h / bands);
    }
    noise(ctx, w, h, 34, 255);
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '120,180,70' : '40,80,25'},0.35)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 4);
    }
    // marcas de pneu leves
    for (const x of [0.32, 0.44, 0.56, 0.68]) {
      ctx.fillStyle = 'rgba(40,70,25,0.18)';
      ctx.fillRect(x * w - 14, 0, 28, h);
    }
    // linhas laterais brancas (pintura na grama)
    ctx.fillStyle = 'rgba(240,240,240,0.9)';
    ctx.fillRect(w * 0.03, 0, w * 0.02, h);
    ctx.fillRect(w * 0.95, 0, w * 0.02, h);
  });
}

function archTexture() {
  return canvasTex(512, 64, (ctx, w, h) => {
    const n = 16;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? '#ff7a00' : '#ffd60a';
      ctx.fillRect((i * w) / n, 0, w / n, h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, h * 0.45, w, h * 0.1);
  });
}

function wallTexture() {
  // 8 m de painel por repeticao em v (aqui: x = comprimento, y = altura)
  return canvasTex(1024, 128, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#f4f6fa');
    grad.addColorStop(0.18, '#f4f6fa');
    grad.addColorStop(0.2, '#1f5fd8');
    grad.addColorStop(0.85, '#123c9c');
    grad.addColorStop(0.87, '#e9ecf2');
    grad.addColorStop(1, '#c9ced8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // chevrons
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    for (let x = -h; x < w; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, h * 0.85);
      ctx.lineTo(x + 32, h * 0.2);
      ctx.lineTo(x + 52, h * 0.2);
      ctx.lineTo(x + 20, h * 0.85);
      ctx.fill();
    }
    ctx.font = 'italic 900 58px Arial, Helvetica, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('STADIUM', 70, h * 0.53);
    ctx.fillStyle = '#ffd60a';
    ctx.fillText('TURBO', 610, h * 0.53);
    // juntas dos paineis
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, 4, h);
    ctx.fillRect(w / 2, 0, 4, h);
  });
}

function grassTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#4f7d35';
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 40, 255);
    for (let i = 0; i < 1600; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '90,140,60' : '40,70,25'},0.35)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 3);
    }
  });
}

function checkerTexture() {
  return canvasTex(512, 64, (ctx, w, h) => {
    const n = 32;
    const s = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 4; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#111' : '#f5f5f5';
        ctx.fillRect(i * s, j * (h / 4), s, h / 4);
      }
    }
  }, { repeat: false });
}

function bannerTexture(text, bg, fg, accent) {
  return canvasTex(1024, 160, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, bg[0]);
    g.addColorStop(1, bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, 10);
    ctx.fillRect(0, h - 10, w, 10);
    ctx.font = 'italic 900 96px Arial, Helvetica, sans-serif';
    const maxW = w - 60;
    const tw = ctx.measureText(text).width;
    if (tw > maxW) ctx.font = `italic 900 ${Math.floor((96 * maxW) / tw)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = fg;
    ctx.fillText(text, w / 2, h / 2 + 4);
  }, { repeat: false });
}

function boosterTexture() {
  return canvasTex(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#1a1206';
    ctx.fillRect(0, 0, w, h);
    for (let k = 0; k < 4; k++) {
      const y = h - k * (h / 4) - 20;
      const g = ctx.createLinearGradient(0, y - 100, 0, y);
      g.addColorStop(0, '#ffe066');
      g.addColorStop(1, '#ff7b00');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(w * 0.12, y);
      ctx.lineTo(w * 0.5, y - 90);
      ctx.lineTo(w * 0.88, y);
      ctx.lineTo(w * 0.7, y);
      ctx.lineTo(w * 0.5, y - 50);
      ctx.lineTo(w * 0.3, y);
      ctx.closePath();
      ctx.fill();
    }
  });
}

// Constroi BufferGeometry a partir de listas
function buildGeometry(pos, uv, idx, color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// lite (graficos baixos): MeshLambertMaterial no lugar do PBR. Sem reflexo do
// ceu e sem especular fisico, cada pixel da pista custa bem menos.
export function createTrackMesh(track, { lite = false } = {}) {
  const stdMat = (o) => {
    if (!lite) return new THREE.MeshStandardMaterial(o);
    const { roughness, metalness, ...rest } = o;
    return new THREE.MeshLambertMaterial(rest);
  };
  const group = new THREE.Group();
  group.name = 'track';
  const n = track.count;
  const hw = track.halfWidth;
  const thick = track.config.wallThickness;
  const wallH = track.config.wallHeight;
  const outer = hw + thick;
  const step = track.step;

  const P = (i, u, lift = 0) => {
    const tb = Math.tan(track.bank[i]);
    return [track.px[i] + track.lx[i] * u, track.py[i] + u * tb + lift, track.pz[i] + track.lz[i] * u];
  };

  // ---------------- asfalto / terra ----------------
  const segS = (i) => (i + 0.5) * step;
  const inGap = (i) => !!track.inGap(segS(i));
  const isDirt = (i) => track.isDirt(segS(i));
  const isGrass = (i) => track.isGrass(segS(i));
  function roadMesh(filter, mat) {
    const pos = [], uv = [], idx = [];
    const across = [-hw, 0, hw];
    for (let i = 0; i < n; i++) {
      if (!filter(i)) continue;
      const base = pos.length / 3;
      for (const [k, sv] of [[i, i * step], [(i + 1) % n, (i + 1) * step]]) {
        for (const u of across) {
          pos.push(...P(k, u, ROAD_LIFT));
          // u=+hw e o lado esquerdo; a textura vai da esquerda (0) para a direita (1)
          uv.push(1 - (u + hw) / (2 * hw), sv / 16);
        }
      }
      for (let a = 0; a < 2; a++) {
        const p0 = base + a, p1 = p0 + 1, p2 = p0 + 3, p3 = p0 + 4;
        idx.push(p0, p2, p1, p1, p2, p3);
      }
    }
    const mesh = new THREE.Mesh(buildGeometry(pos, uv, idx), mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const roadMatOpts = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 };
  roadMesh((i) => !inGap(i) && !isDirt(i) && !isGrass(i), stdMat({
    map: asphaltTexture(), roughness: 0.82, metalness: 0.02, ...roadMatOpts,
  }));
  roadMesh((i) => !inGap(i) && isDirt(i), stdMat({
    map: dirtTexture(), roughness: 1.0, metalness: 0, ...roadMatOpts,
  }));
  roadMesh((i) => !inGap(i) && isGrass(i), stdMat({
    map: turfTexture(), roughness: 0.95, metalness: 0, ...roadMatOpts,
  }));

  // ---------------- zebras (lado interno das curvas) ----------------
  {
    const pos = [], col = [], idx = [];
    const red = new THREE.Color('#d8232a'), white = new THREE.Color('#f4f4f4');
    const CURB_W = 1.3;
    let vi = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const k = track.curv[i];
      if (Math.abs(k) < 1 / 140 || inGap(i) || isDirt(i) || isGrass(i)) continue;
      const side = k > 0 ? 1 : -1; // lado interno
      const u0 = side * (hw - CURB_W);
      const u1 = side * (hw - 0.02);
      const c = Math.floor((i * step) / 3) % 2 ? red : white;
      const quad = [P(i, u0, ROAD_LIFT + 0.03), P(i, u1, ROAD_LIFT + 0.07), P(j, u0, ROAD_LIFT + 0.03), P(j, u1, ROAD_LIFT + 0.07)];
      for (const q of quad) { pos.push(...q); col.push(c.r, c.g, c.b); }
      if (side > 0) idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
      else idx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
      vi += 4;
    }
    const geo = buildGeometry(pos, null, idx, col);
    const mat = stdMat({
      vertexColors: true, roughness: 0.6, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---------------- muros ----------------
  {
    const pos = [], uv = [], idx = [];
    const topPos = [], topIdx = [];
    let vi = 0, ti = 0;
    for (const side of [1, -1]) {
      for (let i = 0; i <= n; i++) {
        const k = i % n;
        const s = (i * step) / 8;
        const inner = P(k, side * hw, 0);
        const outerP = P(k, side * outer, 0);
        const baseIn = [inner[0], inner[1] - 0.4, inner[2]];
        const topIn = [inner[0], inner[1] + wallH, inner[2]];
        const topOut = [outerP[0], inner[1] + wallH, outerP[2]];
        const baseOut = [outerP[0], Math.min(outerP[1], inner[1]) - 0.6, outerP[2]];
        // face interna (painel) e face externa
        pos.push(...baseIn, ...topIn, ...baseOut, ...topOut);
        const su = side > 0 ? s : -s; // texto legivel visto de dentro da pista
        uv.push(su, 0, su, 1, su, 0, su, 1);
        topPos.push(...topIn, ...topOut);
      }
      for (let i = 0; i < n; i++) {
        if (inGap(i)) continue;
        const a = vi + i * 4, b = a + 4;
        if (side > 0) {
          idx.push(a, b, a + 1, a + 1, b, b + 1); // interna (vista de dentro)
          idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); // externa
        } else {
          idx.push(a, a + 1, b, a + 1, b + 1, b);
          idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
        }
        const t0 = ti + i * 2, t1 = t0 + 2;
        if (side > 0) topIdx.push(t0, t1, t0 + 1, t0 + 1, t1, t1 + 1);
        else topIdx.push(t0, t0 + 1, t1, t0 + 1, t1 + 1, t1);
      }
      vi += (n + 1) * 4;
      ti += (n + 1) * 2;
    }
    // a textura e mapeada com y = altura: inverter v para o texto ficar de pe
    const tex = wallTexture();
    const geo = buildGeometry(pos, uv, idx);
    const mat = stdMat({ map: tex, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const topGeo = buildGeometry(topPos, null, topIdx);
    const top = new THREE.Mesh(topGeo, stdMat({ color: 0xe8ebf0, roughness: 0.5, side: THREE.DoubleSide }));
    top.receiveShadow = true;
    group.add(top);
  }

  // ---------------- taludes ----------------
  {
    const pos = [], uv = [], idx = [];
    let vi = 0;
    for (const side of [1, -1]) {
      for (let i = 0; i <= n; i++) {
        const k = i % n;
        const tb = Math.tan(track.bank[k]);
        const edgeY = track.py[k] + side * outer * tb;
        const h = Math.max(0, edgeY);
        const a = P(k, side * outer, 0);
        const ux = track.px[k] + track.lx[k] * side * (outer + h + 0.6);
        const uz = track.pz[k] + track.lz[k] * side * (outer + h + 0.6);
        pos.push(a[0], edgeY - 0.05, a[2], ux, -0.6, uz);
        uv.push(0, (i * step) / 6, (h + 0.6) / 6, (i * step) / 6);
      }
      for (let i = 0; i < n; i++) {
        if (inGap(i)) continue;
        const a = vi + i * 2, b = a + 2;
        if (side > 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
        else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
      vi += (n + 1) * 2;
    }
    const geo = buildGeometry(pos, uv, idx);
    const tex = grassTexture();
    const mesh = new THREE.Mesh(geo, stdMat({ map: tex, color: 0xb8c8a8, roughness: 0.95, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---------------- saltos: faces do vao e arcos ----------------
  const jumpFaceMat = stdMat({ color: 0x3a3f4a, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide });
  const stripeMat = stdMat({ color: 0xffd60a, emissive: 0xff8c00, emissiveIntensity: 0.6, roughness: 0.4 });
  const archTex = archTexture();
  archTex.repeat.set(6, 1);
  const archMat = stdMat({
    map: archTex, emissive: 0xffffff, emissiveMap: archTex, emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.2,
  });
  const archInnerMat = stdMat({ color: 0x0a0f1a, emissive: 0x34c6ff, emissiveIntensity: 1.6 });
  const legMat = stdMat({ color: 0x2b2f38, roughness: 0.4, metalness: 0.6 });
  for (const j of track.jumps) {
    // face vertical na borda do lip e no inicio da aterrissagem
    for (const [sEdge, sign] of [[j.lipS, 1], [j.gapEnd, -1]]) {
      const f = track.frameAt(sEdge);
      const tb = Math.tan(f.bank);
      const pts = [];
      for (const u of [outer, -outer]) {
        const x = f.x + f.lx * u, z = f.z + f.lz * u;
        const y = f.y + u * tb;
        pts.push([x, y + ROAD_LIFT, z], [x, -0.5, z]);
      }
      const face = buildGeometry(pts.flat(), null, [0, 1, 2, 2, 1, 3]);
      const mesh = new THREE.Mesh(face, jumpFaceMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      // faixa de aviso na beirada
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(outer * 2, 0.12, 0.5), stripeMat);
      stripe.position.set(f.x, f.y + 0.06, f.z);
      stripe.rotation.y = f.heading;
      stripe.rotateZ(Math.atan(tb));
      stripe.translateZ(-sign * 0.25);
      group.add(stripe);
    }
    // arcos por onde o carro passa no ar
    for (const sa of j.arches || []) {
      const f = track.frameAt(sa);
      const R = j.archRadius;
      const baseY = Math.max(j.lipY, j.landY) - 1;
      const g = new THREE.Group();
      g.position.set(f.x, baseY, f.z);
      g.rotation.y = f.heading;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.75, 14, 64, Math.PI), archMat);
      ring.castShadow = true;
      g.add(ring);
      const inner = new THREE.Mesh(new THREE.TorusGeometry(R - 0.8, 0.18, 8, 64, Math.PI), archInnerMat);
      g.add(inner);
      for (const sx of [1, -1]) {
        const h = baseY + 0.5;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, h, 12), legMat);
        leg.position.set(sx * R, -h / 2, 0);
        leg.castShadow = true;
        g.add(leg);
      }
      group.add(g);
    }
  }

  // ---------------- porticos ----------------
  const gateMat = stdMat({ color: 0x2b2f38, roughness: 0.4, metalness: 0.6 });
  const whiteMat = stdMat({ color: 0xeef1f5, roughness: 0.35, metalness: 0.2 });

  function makeGate(s, { text, colors, height = 7.5, glow }) {
    const f = track.frameAt(s);
    const g = new THREE.Group();
    g.position.set(f.x, f.y, f.z);
    g.rotation.y = f.heading;
    const legX = hw + 1.3;
    for (const sx of [1, -1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, height, 0.9), gateMat);
      leg.position.set(sx * legX, height / 2 - 0.5, 0);
      leg.castShadow = true;
      g.add(leg);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 1.1), whiteMat);
      cap.position.set(sx * legX, height - 0.35, 0);
      g.add(cap);
    }
    const beamW = legX * 2 + 0.9;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(beamW, 1.8, 0.7), gateMat);
    beam.position.set(0, height + 0.4, 0);
    beam.castShadow = true;
    g.add(beam);
    const tex = bannerTexture(text, colors.bg, colors.fg, colors.accent);
    const bannerMat = stdMat({
      map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow ?? 0.35, roughness: 0.4,
    });
    for (const sz of [1, -1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(beamW - 0.4, 1.5), bannerMat);
      plane.position.set(0, height + 0.4, sz * 0.36);
      if (sz < 0) plane.rotation.y = Math.PI;
      g.add(plane);
    }
    group.add(g);
    return { group: g, bannerMat };
  }

  // linha de largada xadrez
  {
    const s = track.config.startDistance;
    const pos = [], uv = [], idx = [];
    const L = 2.5;
    for (let k = 0; k <= 2; k++) {
      const fr = track.frameAt(s - L / 2 + (k * L) / 2);
      for (const u of [-hw, hw]) {
        const tb = Math.tan(fr.bank);
        pos.push(fr.x + fr.lx * u, fr.y + u * tb + ROAD_LIFT + 0.01, fr.z + fr.lz * u);
        uv.push(u > 0 ? 0 : 1, k / 2);
      }
    }
    for (let k = 0; k < 2; k++) {
      const a = k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const mesh = new THREE.Mesh(
      buildGeometry(pos, uv, idx),
      stdMat({
        map: checkerTexture(), roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
      }),
    );
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  makeGate(track.config.startDistance, {
    text: 'LARGADA  ·  CHEGADA',
    colors: { bg: ['#1b1b1f', '#050507'], fg: '#ffffff', accent: '#e63946' },
    height: 8,
    glow: 0.5,
  });

  const checkpoints = track.config.checkpointFractions.map((fr, i) => {
    const s = fr * track.length;
    const gate = makeGate(s, {
      text: `CHECKPOINT ${i + 1}`,
      colors: { bg: ['#0c6fd6', '#073b8c'], fg: '#ffffff', accent: '#7fd3ff' },
      height: 6.5,
      glow: 0.6,
    });
    return { s, ...gate };
  });

  // ---------------- boosters ----------------
  const boosterTex = boosterTexture();
  const boosters = track.config.boosterFractions.map((fr) => {
    const s = fr * track.length;
    const L = track.config.boosterLength;
    const W = 3.2;
    const pos = [], uv = [], idx = [];
    const segs = 5;
    for (let k = 0; k <= segs; k++) {
      const f = track.frameAt(s + (k * L) / segs);
      const tb = Math.tan(f.bank);
      for (const u of [W, -W]) {
        pos.push(f.x + f.lx * u, f.y + u * tb + ROAD_LIFT + 0.02, f.z + f.lz * u);
        uv.push(u > 0 ? 0 : 1, (k / segs) * 2);
      }
    }
    for (let k = 0; k < segs; k++) {
      const a = k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const mat = stdMat({
      map: boosterTex, emissive: 0xffffff, emissiveMap: boosterTex, emissiveIntensity: 1.2, roughness: 0.5, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    });
    const mesh = new THREE.Mesh(buildGeometry(pos, uv, idx), mat);
    group.add(mesh);
    return { s, length: L, halfWidth: W, mesh };
  });

  const cpIdle = new THREE.Color(0xffffff);
  const cpDone = new THREE.Color(0x7dff9a);

  return {
    group,
    checkpoints,
    boosters,
    update(time, passedCount = 0) {
      boosterTex.offset.y = -time * 1.6;
      checkpoints.forEach((cp, i) => {
        cp.bannerMat.emissive.copy(i < passedCount ? cpDone : cpIdle);
      });
    },
  };
}

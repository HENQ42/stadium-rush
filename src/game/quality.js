// Qualidade grafica: presets, deteccao automatica da GPU e resolucao dinamica.

const QUALITY_KEY = 'stadium-rush.quality';

export const QUALITY_PRESETS = {
  alta: {
    id: 'alta', name: 'Alta',
    antialias: true, maxPixelRatio: 1.5, minPixelRatio: 0.75,
    shadows: true, shadowMapSize: 2048, treeShadows: true, density: 1.0, cloudCover: 0.45, lowPoly: false,
    anisotropy: 8, liteMaterials: false, smoke: 1,
  },
  media: {
    id: 'media', name: 'Media',
    antialias: false, maxPixelRatio: 1.0, minPixelRatio: 0.6,
    shadows: true, shadowMapSize: 1024, treeShadows: false, density: 0.7, cloudCover: 0.45, lowPoly: true,
    anisotropy: 4, liteMaterials: false, smoke: 0.8,
  },
  baixa: {
    id: 'baixa', name: 'Baixa',
    antialias: false, maxPixelRatio: 0.75, minPixelRatio: 0.5,
    shadows: false, shadowMapSize: 512, treeShadows: false, density: 0.45, cloudCover: 0, lowPoly: true,
    anisotropy: 2, liteMaterials: true, smoke: 0.5,
  },
};

export function loadQualityPref() {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return v === 'auto' || QUALITY_PRESETS[v] ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function storeQualityPref(v) {
  try {
    localStorage.setItem(QUALITY_KEY, v);
  } catch {
    /* sem armazenamento */
  }
}

// Nome da GPU (sem criar o renderizador principal).
export function gpuName() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

// Palpite pelo nome da GPU. A resolucao dinamica corrige o resto.
export function detectQuality(name = gpuName()) {
  const n = name.toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(n)) return 'baixa';
  if (/mali|adreno|powervr|videocore|intel\(r\) hd graphics|intel hd graphics|gma/.test(n)) return 'baixa';
  if (/intel|uhd|iris|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|radeon r\d/.test(n)) return 'media';
  return 'alta';
}

export function resolveQuality(pref) {
  const id = pref === 'auto' || !QUALITY_PRESETS[pref] ? detectQuality() : pref;
  return QUALITY_PRESETS[id];
}

export function targetPixelRatio(preset) {
  return Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio);
}

// Baixa a resolucao interna quando o fps cai e sobe de novo quando sobra folga.
export class DynamicResolution {
  constructor(renderer) {
    this.renderer = renderer;
    this.min = 0.5;
    this.max = 1;
    this.pr = 1;
    this.frames = 0;
    this.time = 0;
    this.cool = 0;
    this.upBlock = 0;
    this.lastUp = false;
    this.fps = 0;
  }

  setRange(min, max) {
    this.max = max;
    this.min = Math.min(min, max);
    this.pr = max;
    this.cool = 2;
    this.upBlock = 0;
    this.lastUp = false;
    this._apply();
  }

  _apply() {
    if (Math.abs(this.renderer.getPixelRatio() - this.pr) > 1e-3) this.renderer.setPixelRatio(this.pr);
  }

  // dt = tempo real entre quadros (s)
  update(dt) {
    if (!(dt > 0) || dt > 0.25 || document.hidden) return;
    this.frames++;
    this.time += dt;
    this.cool -= dt;
    this.upBlock -= dt;
    if (this.time < 1) return;
    const fps = this.frames / this.time;
    this.fps = fps;
    this.frames = 0;
    this.time = 0;
    if (this.cool > 0) return;
    if (fps < 50 && this.pr > this.min + 1e-3) {
      this.pr = Math.max(this.min, this.pr * 0.85);
      this.cool = 1.5;
      // se acabou de subir e caiu de novo, fica mais tempo sem tentar subir
      this.upBlock = this.lastUp ? 30 : 5;
      this.lastUp = false;
      this._apply();
    } else if (fps > 58 && this.pr < this.max - 1e-3 && this.upBlock <= 0) {
      this.pr = Math.min(this.max, this.pr * 1.1);
      this.cool = 2;
      this.lastUp = true;
      this._apply();
    }
  }
}

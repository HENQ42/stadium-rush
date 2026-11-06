// Visual retro: a cena e desenhada numa resolucao interna baixa e fixa (ex.:
// 360 linhas) e ampliada com pixels nitidos, como os jogos de corrida de
// PS1/Saturn. Um passe final faz tone mapping, dithering ordenado e reduz a cor
// para 5 bits por canal (paleta de 15 bits). O custo por quadro fica quase
// constante e baixo, entao o fps fica alto e estavel em GPU fraca.
import * as THREE from 'three';

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const POST_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uLevels;
uniform float uDither;
varying vec2 vUv;
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  // matriz de Bayer 4x4 (0..15)
  float b =
    i < 1.0 ? 0.0 : i < 2.0 ? 8.0 : i < 3.0 ? 2.0 : i < 4.0 ? 10.0 :
    i < 5.0 ? 12.0 : i < 6.0 ? 4.0 : i < 7.0 ? 14.0 : i < 8.0 ? 6.0 :
    i < 9.0 ? 3.0 : i < 10.0 ? 11.0 : i < 11.0 ? 1.0 : i < 12.0 ? 9.0 :
    i < 13.0 ? 15.0 : i < 14.0 ? 7.0 : i < 15.0 ? 13.0 : 5.0;
  return (b + 0.5) / 16.0;
}
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 c = clamp(gl_FragColor.rgb, 0.0, 1.0);
  float d = (bayer4(gl_FragCoord.xy) - 0.5) * uDither;
  gl_FragColor = vec4(floor(c * uLevels + 0.5 + d) / uLevels, 1.0);
}`;

export class RetroPipeline {
  constructor(renderer) {
    this.renderer = renderer;
    const ext = renderer.extensions;
    const half = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
    });
    this.material = new THREE.ShaderMaterial({
      name: 'RetroPost',
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uLevels: { value: 31 },
        uDither: { value: 1 },
      },
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._size = new THREE.Vector2();
  }

  // acompanha o tamanho do buffer do canvas (que ja esta na resolucao baixa)
  syncSize() {
    this.renderer.getDrawingBufferSize(this._size);
    const w = Math.max(1, this._size.x | 0);
    const h = Math.max(1, this._size.y | 0);
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
  }

  render(scene, camera) {
    const r = this.renderer;
    this.syncSize();
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }

  // compila os shaders no estado certo (render target) para nao engasgar
  // quando um efeito aparece pela primeira vez
  compile(scene, camera) {
    const r = this.renderer;
    this.syncSize();
    r.setRenderTarget(this.rt);
    r.compile(scene, camera);
    r.setRenderTarget(null);
    r.compile(this.scene, this.camera);
  }

  dispose() {
    this.rt.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}

// Compila todos os materiais da cena, inclusive de objetos escondidos agora
// (fumaca, faiscas, chama do turbo), e envia as texturas para a GPU. Sem isso,
// cada efeito trava o jogo por um instante na primeira vez que aparece.
export function precompileScene(renderer, scene, camera, pipeline = null) {
  const hidden = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  try {
    if (pipeline) pipeline.compile(scene, camera);
    else renderer.compile(scene, camera);
    const seen = new Set();
    scene.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        for (const k of ['map', 'emissiveMap', 'alphaMap']) {
          const t = m[k];
          if (t && !seen.has(t)) {
            seen.add(t);
            renderer.initTexture(t);
          }
        }
      }
    });
  } catch (err) {
    console.warn('precompile falhou', err);
  } finally {
    for (const o of hidden) o.visible = false;
  }
}

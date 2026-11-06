// Mundo 3D de uma pista: cena, cenario, malha da pista e efeitos de pneu.
// Pode ser descartado e recriado ao trocar de pista (salas multiplayer).
import * as THREE from 'three';
import { TrackPath } from '../track/trackPath.js';
import { getTrackDef } from '../track/tracks.js';
import { createEnvironment } from '../scene/environment.js';
import { createTrackMesh } from '../scene/trackMesh.js';
import { TyreEffects } from '../scene/effects.js';

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'alphaMap']) if (m[k]) m[k].dispose();
      m.dispose();
    }
  });
}

export function limitAnisotropy(root, max) {
  root.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k of ['map', 'emissiveMap']) {
        const t = m[k];
        if (t && t.anisotropy > max) {
          t.anisotropy = max;
          t.needsUpdate = true;
        }
      }
    }
  });
}

// quality: preset de src/game/quality.js (sombras, densidade do cenario, nuvens)
export function createWorld(renderer, trackId, quality = null) {
  const def = getTrackDef(trackId);
  const scene = new THREE.Scene();
  const track = new TrackPath(def.points, def.config);
  track.id = def.id;
  track.name = def.name;
  const envOptions = quality
    ? {
        shadows: quality.shadows,
        shadowMapSize: quality.shadowMapSize,
        treeShadows: quality.treeShadows,
        density: quality.density,
        cloudCover: quality.cloudCover,
        lowPoly: quality.lowPoly,
      }
    : {};
  const env = createEnvironment(scene, renderer, track, envOptions);
  const trackMesh = createTrackMesh(track, { lite: !!quality?.liteMaterials });
  scene.add(trackMesh.group);
  const effects = new TyreEffects(scene, { smoke: quality ? quality.smoke : 1 });
  // filtro anisotropico: 8x custa banda de memoria em GPU integrada
  if (quality) limitAnisotropy(scene, quality.anisotropy);

  return {
    id: def.id,
    qualityId: quality ? quality.id : null,
    name: def.name,
    scene,
    track,
    env,
    trackMesh,
    effects,
    // objetos de fora (carros) devem ser removidos da cena antes
    dispose() {
      effects.dispose();
      env.dispose();
      scene.remove(trackMesh.group);
      disposeTree(trackMesh.group);
    },
  };
}

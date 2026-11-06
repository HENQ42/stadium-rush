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

export function createWorld(renderer, trackId) {
  const def = getTrackDef(trackId);
  const scene = new THREE.Scene();
  const track = new TrackPath(def.points, def.config);
  track.id = def.id;
  track.name = def.name;
  const env = createEnvironment(scene, renderer, track);
  const trackMesh = createTrackMesh(track);
  scene.add(trackMesh.group);
  const effects = new TyreEffects(scene);

  return {
    id: def.id,
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

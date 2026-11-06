// Registro das pistas disponiveis.
import { TRACK_POINTS, TRACK_CONFIG } from './trackData.js';
import { SPEEDWAY_POINTS, SPEEDWAY_CONFIG } from './speedwayData.js';

export const TRACKS = {
  speedway: { id: 'speedway', name: 'Speedway (rapida)', points: SPEEDWAY_POINTS, config: SPEEDWAY_CONFIG },
  classic: { id: 'classic', name: 'Classica', points: TRACK_POINTS, config: TRACK_CONFIG },
};

export const DEFAULT_TRACK = 'speedway';

export function getTrackDef(id) {
  return TRACKS[id] || TRACKS[DEFAULT_TRACK];
}

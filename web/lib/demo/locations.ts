// ---
// 📚 WHY: Location catalog for the public /demo page. Each entry is a real
//    municipality of the Valle de Aburrá metropolitan area (Medellín) with real
//    coordinates and hand-set terrain covariates (slope, TWI, lithology, soil).
//    The coordinates make each site pull DIFFERENT real-time rainfall from
//    Open-Meteo, and the covariates make the CIR physics respond differently to
//    that rainfall — so the computed risk is genuinely site-specific, never a
//    shared constant. Covariates are representative planning-grade values for a
//    demo; production runs would source them from the DEM/lithology layers in
//    docs/DATA_SOURCES.md §C (Copernicus DEM GLO-30, SoilGrids).
// 📁 FILE: web/lib/demo/locations.ts
// ---

import type { TerrainCovariates } from './cirEngine.js';

export interface DemoLocation {
  /** 1-based number the user types on the demo page. */
  readonly id: number;
  /** Display name. */
  readonly name: string;
  /** Short descriptor of its position in the valley (shown as a hint). */
  readonly zone: string;
  readonly lat: number;
  readonly lon: number;
  /** Terrain covariates that drive site-specific CIR physics. */
  readonly terrain: TerrainCovariates;
}

// Coordinates: municipal centers of the 10 municipalities of the Valle de Aburrá.
// Terrain covariates reflect the valley's geography: the Aburrá is a narrow N–S
// river valley, flat on the floor (Itagüí, Sabaneta) and steep on the eastern and
// western slopes (Envigado, Bello, Copacabana), on a base of amphibolite/dunite
// with volcanic-ash-derived andosols on the upper slopes.
export const VALLE_DE_ABURRA_LOCATIONS: readonly DemoLocation[] = [
  {
    id: 1, name: 'Medellín', zone: 'Valley floor + eastern slopes',
    lat: 6.2442, lon: -75.5812,
    terrain: { slope: 15, twi: 7.5, lithology: 'amphibolite', soil: 'andosol' },
  },
  {
    id: 2, name: 'Bello', zone: 'Northern valley, steep NW slopes',
    lat: 6.3378, lon: -75.5578,
    terrain: { slope: 28, twi: 9.0, lithology: 'dunite', soil: 'andosol' },
  },
  {
    id: 3, name: 'Itagüí', zone: 'Southern valley floor',
    lat: 6.1719, lon: -75.6112,
    terrain: { slope: 6, twi: 4.5, lithology: 'amphibolite', soil: 'clay loam' },
  },
  {
    id: 4, name: 'Envigado', zone: 'SE foothills, steep eastern slopes',
    lat: 6.1667, lon: -75.5833,
    terrain: { slope: 32, twi: 10.5, lithology: 'volcanic ash', soil: 'andosol' },
  },
  {
    id: 5, name: 'Sabaneta', zone: 'Southern valley floor',
    lat: 6.1518, lon: -75.6168,
    terrain: { slope: 8, twi: 5.0, lithology: 'amphibolite', soil: 'clay loam' },
  },
  {
    id: 6, name: 'Copacabana', zone: 'Northern valley, steep slopes',
    lat: 6.3467, lon: -75.5097,
    terrain: { slope: 26, twi: 9.5, lithology: 'dunite', soil: 'andosol' },
  },
  {
    id: 7, name: 'La Estrella', zone: 'SW slopes',
    lat: 6.1575, lon: -75.6431,
    terrain: { slope: 24, twi: 8.5, lithology: 'weak schist', soil: 'andosol' },
  },
  {
    id: 8, name: 'Girardota', zone: 'Northern valley floor',
    lat: 6.3792, lon: -75.4467,
    terrain: { slope: 12, twi: 6.5, lithology: 'amphibolite', soil: 'clay loam' },
  },
  {
    id: 9, name: 'Barbosa', zone: 'Far-northern valley, mixed terrain',
    lat: 6.4392, lon: -75.3319,
    terrain: { slope: 18, twi: 7.0, lithology: 'amphibolite', soil: 'sandy loam' },
  },
  {
    id: 10, name: 'Caldas', zone: 'Southern headwaters, steep slopes',
    lat: 6.0908, lon: -75.6356,
    terrain: { slope: 30, twi: 11.0, lithology: 'volcanic ash', soil: 'andosol' },
  },
];

/** Look up a location by its 1-based demo id. Returns undefined if out of range. */
export function getLocationById(id: number): DemoLocation | undefined {
  return VALLE_DE_ABURRA_LOCATIONS.find((loc) => loc.id === id);
}

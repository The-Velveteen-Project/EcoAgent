import { z } from 'zod';

/**
 * Terrain covariates for a monitored hillslope unit.
 *
 * Sources are constrained by docs/DATA_SOURCES.md §C:
 * - slope, aspect, curvature, twi, flow_accum: Copernicus DEM GLO-30 derivatives
 * - dist_drainage: OpenStreetMap drainage vectors or DEM-derived drainage network
 * - lithology: SGC geological maps
 * - land_cover: ESA WorldCover
 * - soil: SoilGrids
 *
 * All fields are nullable by design in this stage because verified loaders arrive later.
 */
export const SiteCovariatesSchema = z.object({
  /** Slope angle or slope-derived index from Copernicus DEM GLO-30 derivatives. */
  slope: z.number().nullable().optional(),
  /** Aspect from Copernicus DEM GLO-30 derivatives. */
  aspect: z.number().nullable().optional(),
  /** Curvature from Copernicus DEM GLO-30 derivatives. */
  curvature: z.number().nullable().optional(),
  /** Topographic Wetness Index from Copernicus DEM GLO-30 derivatives. */
  twi: z.number().nullable().optional(),
  /** Flow accumulation from Copernicus DEM GLO-30 derivatives. */
  flow_accum: z.number().nullable().optional(),
  /** Distance to drainage from OpenStreetMap or DEM-derived drainage network. */
  dist_drainage: z.number().nullable().optional(),
  /** Lithology label from SGC geological maps. */
  lithology: z.string().nullable().optional(),
  /** Land-cover label from ESA WorldCover. */
  land_cover: z.string().nullable().optional(),
  /** Soil descriptor from SoilGrids. */
  soil: z.string().nullable().optional(),
});

export type SiteCovariates = z.infer<typeof SiteCovariatesSchema>;

/**
 * Minimal monitored site / hillslope unit model required by the "Observatory" framing.
 */
export const SiteSchema = z.object({
  /** Stable site identifier for persistence and future state continuity. */
  id: z.string().min(1),
  /** Human-readable site name. */
  name: z.string().min(1),
  /** Latitude of the monitored hillslope unit. */
  lat: z.number().min(-90).max(90),
  /** Longitude of the monitored hillslope unit. */
  lon: z.number().min(-180).max(180),
  /** Optional terrain covariates populated by verified loaders in a later stage. */
  covariates: SiteCovariatesSchema.optional(),
});

export type Site = z.infer<typeof SiteSchema>;

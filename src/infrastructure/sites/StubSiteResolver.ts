import type { Site } from '../../domain/models/Site.js';
import { logger } from '../../config/logger.js';

export interface ISiteResolver {
  resolveById(siteId: string): Promise<Site | null>;
}

/**
 * Minimal extensibility seam for site loading.
 *
 * TODO(verify): load lat/lon and terrain covariates from verified sources in docs/DATA_SOURCES.md §C:
 * - Copernicus DEM GLO-30 via GEE / Planetary Computer / OpenTopography
 * - ESA WorldCover via GEE
 * - SoilGrids via GEE / ISRIC
 * - SGC geological maps via datos.sgc.gov.co / SIMMA
 * - OpenStreetMap drainage vectors via Overpass API
 */
export class StubSiteResolver implements ISiteResolver {
  async resolveById(siteId: string): Promise<Site | null> {
    logger.warn({ siteId }, 'TODO(verify): site lookup not yet connected to verified sources');
    return null;
  }
}

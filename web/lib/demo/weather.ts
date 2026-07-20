// ---
// 📚 WHY: Real-time weather forcing for the public /demo page. Uses Open-Meteo
//    (free, no API key) via native fetch — no axios, so it runs in a Next.js API
//    route on Node or Edge. Unlike the bot's single-point "current" reading, this
//    pulls the HOURLY precipitation series (recent past + short forecast) to build
//    the rainfall forcing the CIR engine integrates over. That is what makes the
//    result track the ACTUAL rain each location is getting right now, so two
//    locations under different weather return different risk.
// 📁 FILE: web/lib/demo/weather.ts
// ---

export interface WeatherForcing {
  /** Hourly rainfall series (mm) over the analysis window. */
  readonly rainSeries: number[];
  /** Time step of each bin, in hours (1 for Open-Meteo hourly). */
  readonly dtHours: number;
  /** Current temperature (°C). */
  readonly temperatureC: number;
  /** Current relative humidity (%). */
  readonly humidityPct: number;
  /** Current instantaneous precipitation (mm). */
  readonly precipitationNowMm: number;
  /** Total rainfall accumulated over the window (mm). */
  readonly totalRainfallMm: number;
  /** ISO timestamp of the reading (location local time). */
  readonly observedAt: string;
}

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

// Antecedent rainfall matters more than instantaneous rain for landslide risk:
// soil saturation is the integral of days of prior rainfall. We force the CIR
// simulation with a 14-day antecedent window plus a short forecast, so the
// modeled saturation reflects how wet each site's soil actually is right now.
/** Days of past rainfall to request from Open-Meteo (max 92). */
const PAST_DAYS = 14;
/** Days of forecast rainfall to request. */
const FORECAST_DAYS = 1;

/**
 * Fetches real-time weather for a coordinate and builds the CIR rainfall forcing.
 * @throws Error if the network request fails or the response is malformed.
 */
export async function fetchWeatherForcing(lat: number, lon: number): Promise<WeatherForcing> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,precipitation,relative_humidity_2m',
    hourly: 'precipitation',
    past_days: String(PAST_DAYS),
    forecast_days: String(FORECAST_DAYS),
    timezone: 'auto',
  });

  const res = await fetch(`${OPEN_METEO_URL}?${params.toString()}`, {
    // Never cache — the demo must read live conditions on each request.
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Open-Meteo request failed: HTTP ${res.status}`);
  }

  const data: unknown = await res.json();
  const parsed = data as {
    current?: { temperature_2m?: number; precipitation?: number; relative_humidity_2m?: number; time?: string };
    hourly?: { time?: string[]; precipitation?: (number | null)[] };
  };

  if (!parsed.current || !parsed.hourly?.precipitation || !parsed.hourly.time) {
    throw new Error('Open-Meteo response missing expected fields');
  }

  // Use the full hourly precipitation grid (14 days past + 1 forecast) as the
  // antecedent rainfall forcing. Each bin is one hour; negative/null values are
  // clamped to 0. This integral of prior rainfall is what saturates the soil.
  const precip = parsed.hourly.precipitation.map((v) => (typeof v === 'number' && v >= 0 ? v : 0));
  const safeSeries = precip.length > 0 ? precip : [0];

  const totalRainfall = safeSeries.reduce((sum, v) => sum + v, 0);

  return {
    rainSeries: safeSeries,
    dtHours: 1,
    temperatureC: parsed.current.temperature_2m ?? 18,
    humidityPct: parsed.current.relative_humidity_2m ?? 80,
    precipitationNowMm: parsed.current.precipitation ?? 0,
    totalRainfallMm: Number(totalRainfall.toFixed(2)),
    observedAt: parsed.current.time ?? new Date().toISOString(),
  };
}

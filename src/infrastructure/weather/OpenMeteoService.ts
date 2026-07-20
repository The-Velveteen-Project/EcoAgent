// ---
// 📚 WHY: Implements IWeatherService using Open-Meteo (free API, no API key).
//    Validates the response with Zod because the Open-Meteo API can change its format
//    without prior notice. The 10s timeout is aggressive on purpose: if the service takes
//    longer, it's better to fail fast and tell the user to try again later.
// 📁 FILE: src/infrastructure/weather/OpenMeteoService.ts
// ---

import axios, { type AxiosInstance } from 'axios';
import { z } from 'zod';
import type { IWeatherService, WeatherData } from '../../domain/ports/IWeatherService.js';
import { MANIZALES_LAT, MANIZALES_LON } from '../../domain/ports/IWeatherService.js';
import { logger } from '../../config/logger.js';

// ── Open-Meteo response schema ───────────────────────────────
const OpenMeteoResponseSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    precipitation: z.number(),
    relative_humidity_2m: z.number(),
    wind_speed_10m: z.number(),
    time: z.string(),
  }),
});

export class OpenMeteoService implements IWeatherService {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.open-meteo.com/v1',
      timeout: 10_000,
    });
  }

  async getCurrentWeather(
    lat: number = MANIZALES_LAT,
    lon: number = MANIZALES_LON
  ): Promise<WeatherData> {
    logger.debug({ lat, lon }, 'Fetching weather from Open-Meteo');

    const response = await this.client.get('/forecast', {
      params: {
        latitude: lat,
        longitude: lon,
        current: 'temperature_2m,precipitation,relative_humidity_2m,wind_speed_10m',
        timezone: 'auto',
      },
    });

    const parsed = OpenMeteoResponseSchema.safeParse(response.data);

    if (!parsed.success) {
      logger.error(
        { err: parsed.error, rawResponse: response.data },
        'Open-Meteo response failed schema validation'
      );
      throw new Error(`Weather data schema mismatch: ${parsed.error.message}`);
    }

    const current = parsed.data.current;

    const weather: WeatherData = {
      temperature_c: current.temperature_2m,
      precipitation_mm: current.precipitation,
      humidity_pct: current.relative_humidity_2m,
      wind_speed_kmh: current.wind_speed_10m,
      timestamp: new Date(current.time),
    };

    logger.info(
      { temp: weather.temperature_c, precip: weather.precipitation_mm },
      'Weather data fetched'
    );

    return weather;
  }
}

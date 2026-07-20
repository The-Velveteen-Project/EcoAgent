// ---
// 📚 WHY: Defines the contract for obtaining real-time weather data.
//    Separating the interface from the implementation (Open-Meteo) allows changing the provider
//    without touching the bot's logic, and testing with deterministic data in the tests.
//    The default coordinates center the service on Manizales, Colombia.
// 📁 FILE: src/domain/ports/IWeatherService.ts
// ---

import { z } from 'zod';

// ── Default coordinates for Manizales, Colombia ──────────────
export const MANIZALES_LAT = 5.0703;
export const MANIZALES_LON = -75.5138;

// ── Weather Data Schema ──────────────────────────────────────
export const WeatherDataSchema = z.object({
  /** Air temperature at 2m height in Celsius. */
  temperature_c: z.number(),

  /** Accumulated precipitation in millimeters. */
  precipitation_mm: z.number(),

  /** Relative humidity as percentage (0–100). */
  humidity_pct: z.number(),

  /** Wind speed at 10m height in km/h. */
  wind_speed_kmh: z.number(),

  /** Timestamp of the weather observation. */
  timestamp: z.coerce.date(),
});

export type WeatherData = z.infer<typeof WeatherDataSchema>;

// ── Port Interface ───────────────────────────────────────────
export interface IWeatherService {
  /**
   * Fetches current weather conditions for the given coordinates.
   * Defaults to Manizales if no coordinates are provided.
   */
  getCurrentWeather(lat?: number, lon?: number): Promise<WeatherData>;
}

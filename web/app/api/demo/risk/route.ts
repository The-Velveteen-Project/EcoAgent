// ---
// 📚 WHY: Public, no-auth risk endpoint for the /demo page. Given a Valle de
//    Aburrá location id, it fetches real-time antecedent rainfall for that exact
//    coordinate from Open-Meteo and runs the standalone CIR simulation with the
//    site's terrain covariates. No Supabase, no login, no Python backend — so it
//    can be scanned from a QR code during a live talk and just works. The result
//    is genuinely site-specific: real per-location weather × per-site terrain.
// 📁 FILE: web/app/api/demo/risk/route.ts
// ---

import { NextResponse } from 'next/server';
import { runCIRSimulation, saturationIndex, alertLevelFromIndex } from '@/lib/demo/cirEngine';
import { getLocationById, VALLE_DE_ABURRA_LOCATIONS } from '@/lib/demo/locations';
import { fetchWeatherForcing } from '@/lib/demo/weather';

// Always run fresh — the demo must reflect live conditions on every request.
export const dynamic = 'force-dynamic';

interface DemoRiskRequest {
  locationId?: number;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as DemoRiskRequest;
    const locationId = Number(body.locationId);

    if (!Number.isInteger(locationId)) {
      return NextResponse.json(
        { error: 'Provide a numeric locationId.' },
        { status: 400 }
      );
    }

    const location = getLocationById(locationId);
    if (!location) {
      return NextResponse.json(
        {
          error: `Unknown location ${locationId}. Choose 1–${VALLE_DE_ABURRA_LOCATIONS.length}.`,
        },
        { status: 404 }
      );
    }

    // 1. Real-time antecedent rainfall + current conditions for this coordinate.
    const weather = await fetchWeatherForcing(location.lat, location.lon);

    // 2. Deterministic per-site seed so repeated calls in a demo are stable.
    const seed = Math.round(Math.abs(location.lat * 1000 + location.lon * 1000)) >>> 0;

    // 3. Run the CIR simulation with real weather + this site's terrain.
    const sim = runCIRSimulation({
      rainSeries: weather.rainSeries,
      dtHours: weather.dtHours,
      terrain: location.terrain,
      humidityPct: weather.humidityPct,
      temperatureC: weather.temperatureC,
      S0: 0.4,
      nSimulations: 2000,
      seed,
    });

    // 4. Site-relative saturation index → the differentiating risk signal.
    const index = saturationIndex(sim);
    const alertLevel = alertLevelFromIndex(index);

    return NextResponse.json({
      location: {
        id: location.id,
        name: location.name,
        zone: location.zone,
        lat: location.lat,
        lon: location.lon,
      },
      risk: {
        level: alertLevel,
        saturation_index: index,
        mean_saturation: sim.mean_saturation,
        critical_saturation: sim.critical_saturation,
        risk_probability: sim.risk_probability,
      },
      weather: {
        temperature_c: weather.temperatureC,
        humidity_pct: weather.humidityPct,
        precipitation_now_mm: weather.precipitationNowMm,
        antecedent_rainfall_mm: weather.totalRainfallMm,
        observed_at: weather.observedAt,
      },
      model_version: sim.model_version,
      computed_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

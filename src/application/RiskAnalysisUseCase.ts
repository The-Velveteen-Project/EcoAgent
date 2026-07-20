// ---
// 📚 WHY: Orchestrates the complete risk analysis flow as a use case.
//    Receives all dependencies via constructor (DI) for full testability.
//    The weather→simulation→voice flow is sequential and immutable: if a step is missing,
//    the report degrades gracefully (without voice, but with data). This is the heart
//    of the business logic, decoupled from Telegram, HTTP, or any framework.
// 📁 FILE: src/application/RiskAnalysisUseCase.ts
// ---

import type { ISimulationEngine, CIRSimulationOutput } from '../domain/ports/ISimulationEngine.js';
import type { IVoiceService } from '../domain/ports/IVoiceService.js';
import type { IWeatherService, WeatherData } from '../domain/ports/IWeatherService.js';
import type { ISessionRepository } from '../infrastructure/session/SessionRepository.js';
import { type AlertThreshold, DEFAULT_USER_SETTINGS } from '../domain/models/UserSession.js';
import type { Site } from '../domain/models/Site.js';
import {
  SimulationRateLimitError,
  SimulationServiceUnavailableError,
} from '../infrastructure/simulation/errors.js';
import { logger } from '../config/logger.js';
import type OpenAI from 'openai';
import { settings as appSettings } from '../config/settings.js';

// ── RiskReport Type ──────────────────────────────────────────
export interface RiskReport {
  readonly weather: WeatherData;
  readonly simulation: CIRSimulationOutput;
  readonly audio_buffer?: Buffer;
  readonly generated_at: Date;
  readonly alert_level: AlertThreshold;
  readonly ai_summary?: string;
}

export class RiskAnalysisUseCase {
  private static readonly WEATHER_RETRY_DELAYS_MS = [800, 1800] as const;
  private static readonly SIMULATION_RETRY_DELAYS_MS = [1200, 2600] as const;
  private static readonly COLD_START_S0 = 0.2;

  constructor(
    private readonly simulationEngine: ISimulationEngine,
    private readonly voiceService: IVoiceService,
    private readonly weatherService: IWeatherService,
    private readonly sessionRepo: ISessionRepository,
    private readonly openai: OpenAI
  ) {}

  /**
   * Full risk analysis pipeline for a specific user.
   *
   * Flow:
   * 1. Read user settings → get their location and preferences
   * 2. Fetch current weather → real-time climate data
   * 3. Run CIR simulation → stochastic risk assessment
   * 4. Generate AI Executive Summary via OpenRouter
   * 5. If HIGH/CRITICAL + voice_enabled → synthesize voice report
   * 6. Save result to conversation history
   * 7. Return typed RiskReport
   */
  async analyzeRisk(chatId: string): Promise<RiskReport> {
    const startTime = Date.now();

    // 1. Load user settings — fallback to defaults if not found in SaaS DB
    const settings = (await this.sessionRepo.getSettings(chatId)) ?? DEFAULT_USER_SETTINGS;

    logger.info({ chatId, lat: settings.location_lat, lon: settings.location_lon }, 'Starting risk analysis');

    // 2. Fetch current weather for user's configured location
    const weather = await this.retryStep(
      'weather',
      RiskAnalysisUseCase.WEATHER_RETRY_DELAYS_MS,
      () => this.weatherService.getCurrentWeather(
        settings.location_lat,
        settings.location_lon
      ),
      () => true,
      { chatId, lat: settings.location_lat, lon: settings.location_lon }
    );

    // 3. Run CIR simulation with weather data
    const site = this.buildConfiguredSite(settings.location_lat, settings.location_lon);
    const initialSaturation = await this.resolveInitialSaturation(site.id);
    const simulation = await this.retryStep(
      'simulation',
      RiskAnalysisUseCase.SIMULATION_RETRY_DELAYS_MS,
      () => this.simulationEngine.simulate({
        precipitation_mm: weather.precipitation_mm,
        humidity_pct: weather.humidity_pct,
        temperature_c: weather.temperature_c,
        n_simulations: 1000,
        time_horizon_hours: 24,
        S0: initialSaturation,
        rain_series: this.buildHourlyRainSeries(weather.precipitation_mm, 24),
        dt_hours: 1,
        seed: this.seedFromChatId(chatId),
        site_id: site.id,
        site,
      }),
      (err) =>
        err instanceof SimulationServiceUnavailableError ||
        err instanceof SimulationRateLimitError,
      { chatId }
    );
    await this.sessionRepo.saveSiteState(site.id, this.extractSaturationEstimate(simulation));

    // 4. Generate AI Executive Summary
    let aiSummary = '';
    const isEn = settings.language === 'en';
    
    try {
      const systemPrompt = isEn
        ? 'You are an expert in regional geology of Colombia and landslide risk management. You receive raw data (temperature °C, precipitation mm, humidity %, risk probability %, alert level) for the user\'s location, specifically in the mountainous Andean region. You must write a professional, direct, and authoritative executive summary of maximum 2 to 3 lines. Explain what these data mean for the stability of the terrain in the Colombian context. NEVER use markdown (e.g. asterisks or bold) or greetings. Respond in English.'
        : 'Eres un experto en geología regional de Colombia y gestión de riesgo de deslizamientos. Recibes datos crudos (temperatura en °C, precipitación en mm, humedad %, probabilidad de riesgo %, nivel de alerta) de la ubicación del usuario, específicamente en la región andina montañosa. Debes escribir un resumen ejecutivo profesional, directo y autoritario de máximo 2 a 3 líneas. Explica qué significan estos datos para la estabilidad del terreno en el contexto colombiano. NUNCA uses markdown (ej. asteriscos o negritas) ni saludes. Responde en Español.';

      const summaryRes = await this.openai.chat.completions.create({
        model: appSettings.OPENROUTER_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: isEn 
              ? `Input Data: Temp: ${weather.temperature_c}°C, Precip: ${weather.precipitation_mm}mm, Humidity: ${weather.humidity_pct}%. Risk Probability: ${(simulation.risk_probability * 100).toFixed(1)}%. Alert Level: ${simulation.alert_level}.`
              : `Datos de entrada: Temp: ${weather.temperature_c}°C, Precipitación: ${weather.precipitation_mm}mm, Humedad: ${weather.humidity_pct}%. Probabilidad de deslizamiento: ${(simulation.risk_probability * 100).toFixed(1)}%. Nivel de Alerta: ${simulation.alert_level}.`
          }
        ],
        temperature: 0.3,
        max_tokens: 150,
      });
      aiSummary = summaryRes.choices[0]?.message?.content?.trim() || '';
    } catch (err) {
      logger.error({ err }, 'Failed to generate AI summary for risk report');
      aiSummary = isEn 
        ? 'AI summary could not be generated at this time.'
        : 'No fue posible generar el resumen con IA en este momento.';
    }

    // 5. Voice synthesis — only for HIGH/CRITICAL + voice_enabled
    let audioBuffer: Buffer | undefined;

    const isHighRisk =
      simulation.alert_level === 'HIGH' || simulation.alert_level === 'CRITICAL';

    if (isHighRisk && settings.voice_enabled) {
      const summaryText = this.buildVoiceSummary(weather, simulation, settings.language);
      const buffer = await this.voiceService.synthesize(summaryText);
      if (buffer) {
        audioBuffer = buffer;
      }
    }

    // 6. Save to conversation history
    const reportMessage = this.buildReportMessage(weather, simulation, aiSummary, settings.language);
    await this.sessionRepo.appendMessage(chatId, {
      role: 'assistant',
      content: reportMessage,
      timestamp: new Date(),
    });

    const elapsed = Date.now() - startTime;
    logger.info(
      { chatId, alert_level: simulation.alert_level, elapsed_ms: elapsed, hasAudio: !!audioBuffer, hasSummary: !!aiSummary },
      'Risk analysis completed'
    );

    // 7. Return typed report
    const report: RiskReport = {
      weather,
      simulation,
      ... (audioBuffer ? { audio_buffer: audioBuffer } : {}),
      generated_at: new Date(),
      alert_level: simulation.alert_level,
      ai_summary: aiSummary,
    };

    // 8. Output data to Supabase
    await this.sessionRepo.saveReport(chatId, report);

    return report;
  }

  private buildVoiceSummary(weather: WeatherData, sim: CIRSimulationOutput, lang: string): string {
    if (lang === 'en') {
      return (
        `Climate risk alert. ` +
        `Level: ${sim.alert_level}. ` +
        `Risk probability: ${(sim.risk_probability * 100).toFixed(1)} percent. ` +
        `Current temperature: ${weather.temperature_c} degrees. ` +
        `Precipitation: ${weather.precipitation_mm} millimeters. ` +
        `Humidity: ${weather.humidity_pct} percent. ` +
        `Constant monitoring is recommended.`
      );
    }
    return (
      `Alerta de riesgo climático. ` +
      `Nivel: ${sim.alert_level}. ` +
      `Probabilidad de riesgo: ${(sim.risk_probability * 100).toFixed(1)} por ciento. ` +
      `Temperatura actual: ${weather.temperature_c} grados. ` +
      `Precipitación: ${weather.precipitation_mm} milímetros. ` +
      `Humedad: ${weather.humidity_pct} por ciento. ` +
      `Se recomienda monitoreo constante.`
    );
  }

  private buildConfiguredSite(lat: number, lon: number): Site {
    return {
      id: `configured-site:${lat.toFixed(5)},${lon.toFixed(5)}`,
      name: `Configured site ${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      lat,
      lon,
      // TODO(verify): enrich with verified covariates from docs/DATA_SOURCES.md §C loaders.
      covariates: {},
    };
  }

  private async resolveInitialSaturation(siteId: string): Promise<number> {
    const persisted = await this.sessionRepo.getSiteState(siteId);
    if (persisted !== null) {
      return persisted;
    }

    // TODO(verify): replace this low cold-start with warm-up over the last ~25 days of
    // verified IDEA/SIMAC rainfall once the rainfall loader is connected here.
    logger.warn(
      { siteId, S0: RiskAnalysisUseCase.COLD_START_S0 },
      'No persisted physical site state or verified 25-day rainfall warm-up available; using low uncalibrated cold-start'
    );
    return RiskAnalysisUseCase.COLD_START_S0;
  }

  private extractSaturationEstimate(simulation: CIRSimulationOutput): number {
    return Math.min(Math.max(simulation.S_mean ?? simulation.mean_saturation, 0), 1);
  }

  private buildHourlyRainSeries(totalPrecipitationMm: number, horizonHours: number): number[] {
    const steps = Math.max(1, horizonHours);
    return Array.from({ length: steps }, () => totalPrecipitationMm / steps);
  }

  private seedFromChatId(chatId: string): number {
    let hash = 2166136261;
    for (const char of chatId) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private buildReportMessage(weather: WeatherData, sim: CIRSimulationOutput, aiSummary: string, lang: string): string {
    const isEn = lang === 'en';
    const emoji =
      sim.alert_level === 'CRITICAL' ? '🔴' :
      sim.alert_level === 'HIGH' ? '🟠' :
      sim.alert_level === 'MEDIUM' ? '🟡' : '🟢';

    const header = isEn ? 'Risk Analysis' : 'Análisis de Riesgo';
    const probLabel = isEn ? 'Probability' : 'Probabilidad';
    const saturationLabel = isEn ? 'Mean saturation' : 'Saturación media';
    const weatherLabel = isEn ? 'Temp' : 'Temp';
    const rainLabel = isEn ? 'Rain' : 'Lluvia';
    const humidityLabel = isEn ? 'Humidity' : 'Humedad';
    const aiLabel = isEn ? 'AI Executive Summary' : 'Resumen Ejecutivo (IA)';

    return (
      `${emoji} ${header} — ${sim.alert_level}\n` +
      `${probLabel}: ${(sim.risk_probability * 100).toFixed(1)}%\n` +
      `${saturationLabel}: ${sim.mean_saturation.toFixed(4)}\n` +
      `${weatherLabel}: ${weather.temperature_c}°C | ${rainLabel}: ${weather.precipitation_mm}mm | ${humidityLabel}: ${weather.humidity_pct}%\n\n` +
      `💡 *${aiLabel}*:\n${aiSummary}`
    );
  }

  private async retryStep<T>(
    stepName: 'weather' | 'simulation',
    delaysMs: readonly number[],
    operation: () => Promise<T>,
    shouldRetry: (err: unknown) => boolean,
    logContext: Record<string, unknown>
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;

        const hasRetriesLeft = attempt < delaysMs.length;
        if (!hasRetriesLeft || !shouldRetry(err)) {
          throw err;
        }

        const delayMs = delaysMs[attempt]!;
        logger.warn(
          {
            ...logContext,
            step: stepName,
            attempt: attempt + 1,
            retry_in_ms: delayMs,
            err,
          },
          `Transient ${stepName} failure; retrying`
        );

        await this.sleep(delayMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Unknown ${stepName} failure`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

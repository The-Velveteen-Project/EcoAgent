// ---
// 📚 WHY: Verifies that the use case correctly orchestrates the business logic:
//    voice is ONLY called for HIGH/CRITICAL + voice_enabled, and weather errors
//    propagate without fabricating data. Without these tests, a refactor could silently
//    stop calling synthesize(), or worse, generate reports with fictitious data.
// 📁 FILE: src/application/RiskAnalysisUseCase.test.ts
// ---

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RiskAnalysisUseCase } from './RiskAnalysisUseCase.js';
import type { ISimulationEngine, CIRSimulationOutput } from '../domain/ports/ISimulationEngine.js';
import type { IVoiceService } from '../domain/ports/IVoiceService.js';
import type { IWeatherService, WeatherData } from '../domain/ports/IWeatherService.js';
import type { ISessionRepository } from '../infrastructure/session/SessionRepository.js';
import type { UserSettings } from '../domain/models/UserSession.js';
import { SimulationServiceUnavailableError } from '../infrastructure/simulation/errors.js';

vi.mock('../config/settings.js', () => ({
  settings: {
    OPENROUTER_MODEL: 'openai/gpt-4o-mini',
  },
}));

// Mock logger
vi.mock('../config/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

const MOCK_SETTINGS: UserSettings = {
  alert_threshold: 'HIGH',
  location_lat: 5.0703,
  location_lon: -75.5138,
  language: 'es',
  voice_enabled: true,
  report_frequency_hours: 6,
};

const MOCK_WEATHER: WeatherData = {
  temperature_c: 18,
  precipitation_mm: 12,
  humidity_pct: 85,
  wind_speed_kmh: 15,
  timestamp: new Date(),
};

function createMockSimulation(overrides: Partial<CIRSimulationOutput> = {}): CIRSimulationOutput {
  return {
    prob_failure: 0.8,
    S_mean: 0.65,
    S_std: 0.12,
    S_q_high: 0.81,
    hazard_probability_mean: 0.71,
    model_version: 'jacobi_rainfall_forced_v2',
    risk_probability: 0.8,
    mean_saturation: 0.65,
    std_saturation: 0.12,
    alert_level: 'CRITICAL',
    ...overrides,
  };
}

function createMocks() {
  const simulationEngine: ISimulationEngine = {
    simulate: vi.fn().mockResolvedValue(createMockSimulation()),
    healthCheck: vi.fn().mockResolvedValue(true),
  };

  const voiceService: IVoiceService = {
    synthesize: vi.fn().mockResolvedValue(Buffer.from('audio-data')),
  };

  const weatherService: IWeatherService = {
    getCurrentWeather: vi.fn().mockResolvedValue(MOCK_WEATHER),
  };

  const sessionRepo: ISessionRepository = {
    getOrCreate: vi.fn(),
    save: vi.fn(),
    getSettings: vi.fn().mockResolvedValue(MOCK_SETTINGS),
    updateSettings: vi.fn(),
    getSiteState: vi.fn().mockResolvedValue(null),
    saveSiteState: vi.fn(),
    appendMessage: vi.fn(),
    getHistory: vi.fn().mockResolvedValue([]),
    saveReport: vi.fn(),
    isUserLinked: vi.fn().mockResolvedValue(true),
  };

  const openai: any = {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'AI summary' } }],
        }),
      },
    },
  };

  return { simulationEngine, voiceService, weatherService, sessionRepo, openai };
}

describe('RiskAnalysisUseCase', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  // TEST: CRITICAL alert + voice_enabled → voice.synthesize() IS called.
  // WHY: High-risk situations require multi-channel alerts. If voice synthesis
  //      silently stops being called, users won't receive urgent audio alerts.
  it('calls voice.synthesize() when alert is CRITICAL and voice is enabled', async () => {
    const mocks = createMocks();
    (mocks.simulationEngine.simulate as ReturnType<typeof vi.fn>).mockResolvedValue(
      createMockSimulation({ alert_level: 'CRITICAL' })
    );

    const useCase = new RiskAnalysisUseCase(
      mocks.simulationEngine,
      mocks.voiceService,
      mocks.weatherService,
      mocks.sessionRepo,
      mocks.openai
    );

    await useCase.analyzeRisk('chat-123');

    expect(mocks.voiceService.synthesize).toHaveBeenCalledOnce();
  });

  // TEST: LOW alert → voice.synthesize() is NOT called.
  // WHY: Voice synthesis costs money (ElevenLabs API). Calling it for LOW risk
  //      wastes credits and annoys users with unnecessary audio messages.
  it('does NOT call voice.synthesize() when alert is LOW', async () => {
    const mocks = createMocks();
    (mocks.simulationEngine.simulate as ReturnType<typeof vi.fn>).mockResolvedValue(
      createMockSimulation({ alert_level: 'LOW', risk_probability: 0.05, prob_failure: 0.05 })
    );

    const useCase = new RiskAnalysisUseCase(
      mocks.simulationEngine,
      mocks.voiceService,
      mocks.weatherService,
      mocks.sessionRepo,
      mocks.openai
    );

    await useCase.analyzeRisk('chat-123');

    expect(mocks.voiceService.synthesize).not.toHaveBeenCalled();
  });

  // TEST: Weather service failure → error propagates, no fabricated data.
  // WHY: Anti-hallucination requirement. If weather data can't be fetched,
  //      the use case MUST throw — never generate a report with fake data.
  it('propagates weather service errors without fabricating data', async () => {
    vi.useFakeTimers();
    const mocks = createMocks();
    (mocks.weatherService.getCurrentWeather as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Weather API timeout')
    );

    const useCase = new RiskAnalysisUseCase(
      mocks.simulationEngine,
      mocks.voiceService,
      mocks.weatherService,
      mocks.sessionRepo,
      mocks.openai
    );

    const reportPromise = useCase.analyzeRisk('chat-123');
    const rejection = expect(reportPromise).rejects.toThrow('Weather API timeout');
    await vi.advanceTimersByTimeAsync(2600);

    await rejection;

    // Simulation should NOT have been called — no fake data path
    expect(mocks.simulationEngine.simulate).not.toHaveBeenCalled();
  });

  // TEST: HIGH alert + voice_enabled → voice IS called (not just CRITICAL).
  // WHY: Both HIGH and CRITICAL are actionable alert levels for voice.
  it('calls voice.synthesize() when alert is HIGH and voice is enabled', async () => {
    const mocks = createMocks();
    (mocks.simulationEngine.simulate as ReturnType<typeof vi.fn>).mockResolvedValue(
      createMockSimulation({ alert_level: 'HIGH', risk_probability: 0.5 })
    );

    const useCase = new RiskAnalysisUseCase(
      mocks.simulationEngine,
      mocks.voiceService,
      mocks.weatherService,
      mocks.sessionRepo,
      mocks.openai
    );

    await useCase.analyzeRisk('chat-123');

    expect(mocks.voiceService.synthesize).toHaveBeenCalledOnce();
  });

  it('retries weather fetch and succeeds on a transient failure', async () => {
    vi.useFakeTimers();
    const mocks = createMocks();
    (mocks.weatherService.getCurrentWeather as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Temporary weather timeout'))
      .mockResolvedValue(MOCK_WEATHER);

    const useCase = new RiskAnalysisUseCase(
      mocks.simulationEngine,
      mocks.voiceService,
      mocks.weatherService,
      mocks.sessionRepo,
      mocks.openai
    );

    const reportPromise = useCase.analyzeRisk('chat-123');
    await vi.advanceTimersByTimeAsync(800);
    const report = await reportPromise;

    expect(report.weather.temperature_c).toBe(MOCK_WEATHER.temperature_c);
    expect(mocks.weatherService.getCurrentWeather).toHaveBeenCalledTimes(2);
    expect(mocks.simulationEngine.simulate).toHaveBeenCalledOnce();
  });

  it('retries simulation when the Python engine is temporarily unavailable', async () => {
    vi.useFakeTimers();
    const mocks = createMocks();
    (mocks.simulationEngine.simulate as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new SimulationServiceUnavailableError('engine unavailable'))
      .mockResolvedValue(createMockSimulation({ alert_level: 'MEDIUM', risk_probability: 0.2, prob_failure: 0.2 }));

    const useCase = new RiskAnalysisUseCase(
      mocks.simulationEngine,
      mocks.voiceService,
      mocks.weatherService,
      mocks.sessionRepo,
      mocks.openai
    );

    const reportPromise = useCase.analyzeRisk('chat-123');
    await vi.advanceTimersByTimeAsync(1200);
    const report = await reportPromise;

    expect(report.alert_level).toBe('MEDIUM');
    expect(mocks.simulationEngine.simulate).toHaveBeenCalledTimes(2);
  });

  it('chains physical site saturation state across consecutive analyses for the same site', async () => {
    const mocks = createMocks();
    let persistedState: number | null = null;

    (mocks.sessionRepo.getSiteState as ReturnType<typeof vi.fn>).mockImplementation(async () => persistedState);
    (mocks.sessionRepo.saveSiteState as ReturnType<typeof vi.fn>).mockImplementation(
      async (_siteId: string, saturationEstimate: number) => {
        persistedState = saturationEstimate;
      }
    );
    (mocks.simulationEngine.simulate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(createMockSimulation({ S_mean: 0.63, mean_saturation: 0.63 }))
      .mockResolvedValueOnce(createMockSimulation({ S_mean: 0.71, mean_saturation: 0.71 }));

    const useCase = new RiskAnalysisUseCase(
      mocks.simulationEngine,
      mocks.voiceService,
      mocks.weatherService,
      mocks.sessionRepo,
      mocks.openai
    );

    await useCase.analyzeRisk('chat-123');
    await useCase.analyzeRisk('another-chat-same-coordinates');

    const firstInput = (mocks.simulationEngine.simulate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const secondInput = (mocks.simulationEngine.simulate as ReturnType<typeof vi.fn>).mock.calls[1][0];

    expect(firstInput.site_id).toBe('configured-site:5.07030,-75.51380');
    expect(firstInput.S0).toBe(0.2);
    expect(secondInput.site_id).toBe(firstInput.site_id);
    expect(secondInput.S0).toBe(0.63);
    expect(mocks.sessionRepo.saveSiteState).toHaveBeenNthCalledWith(1, firstInput.site_id, 0.63);
    expect(mocks.sessionRepo.saveSiteState).toHaveBeenNthCalledWith(2, firstInput.site_id, 0.71);
  });
});

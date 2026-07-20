// ---
// 📚 WHY: Entry point that composes the DI container and starts the bot.
//    This is the Clean Architecture "composition root": every concrete
//    implementation is instantiated here and injected into the classes that
//    need it. Without this central point, dependencies would be scattered and
//    tightly coupled.
// 📁 FILE: src/index.ts
// ---

import OpenAI from 'openai';
import { settings } from './config/settings.js';
import { logger } from './config/logger.js';

// ── Infrastructure ───────────────────────────────────────────
import { FailoverSimulationEngine } from './infrastructure/simulation/FailoverSimulationEngine.js';
import { LocalCIREngine } from './infrastructure/simulation/LocalCIREngine.js';
import { PythonCIREngine } from './infrastructure/simulation/PythonCIREngine.js';
import { ElevenLabsService } from './infrastructure/voice/ElevenLabsService.js';
import { OpenMeteoService } from './infrastructure/weather/OpenMeteoService.js';
import { SupabaseSessionRepository } from './infrastructure/session/SupabaseSessionRepository.js';

// ── Application ──────────────────────────────────────────────
import { RiskAnalysisUseCase } from './application/RiskAnalysisUseCase.js';
import { ModelExplanationUseCase } from './application/ModelExplanationUseCase.js';

// ── Interface ────────────────────────────────────────────────
import { createBot, startBot } from './interfaces/telegram/bot.js';

// ── Global error handlers ────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception — shutting down');
  process.exit(1);
});

// ── Composition Root ─────────────────────────────────────────
async function main(): Promise<void> {
  logger.info('Composing ALLO dependency graph...');

  // 1. Infrastructure layer
  const pythonSimulationEngine = new PythonCIREngine(settings.PYTHON_API_URL);
  const localSimulationEngine = new LocalCIREngine();
  const simulationEngine = new FailoverSimulationEngine(
    pythonSimulationEngine,
    localSimulationEngine
  );
  const voiceService = new ElevenLabsService(
    settings.ELEVENLABS_API_KEY,
    settings.ELEVENLABS_VOICE_ID
  );
  const weatherService = new OpenMeteoService();
  
  if (!settings.SUPABASE_URL || !settings.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase URL and Service Role Key are required for SaaS mode');
  }
  const sessionRepo = new SupabaseSessionRepository(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY);

  // 2. Setup AI Client
  const openai = new OpenAI({
    apiKey: settings.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  });

  // 3. Application layer (use cases)
  const riskAnalysis = new RiskAnalysisUseCase(
    simulationEngine,
    voiceService,
    weatherService,
    sessionRepo,
    openai
  );
  
  const modelExplanation = new ModelExplanationUseCase(
    openai,
    sessionRepo
  );

  // 3. Interface layer (Telegram bot)
  const bot = createBot({
    token: settings.TELEGRAM_BOT_TOKEN,
    allowedUserIds: settings.TELEGRAM_ALLOWED_USER_IDS,
    sessionRepo,
    riskAnalysis,
    modelExplanation,
    openai,
    weatherService,
    simulationEngine,
    voiceService,
  });

  // 4. Health check Python engine
  const engineHealthy = await pythonSimulationEngine.healthCheck();
  if (engineHealthy) {
    logger.info('Python CIR engine is healthy');
  } else {
    logger.warn('Python CIR engine is not reachable — local CIR fallback will be used for /clima');
  }

  // 5. Start bot
  await startBot(bot);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start ALLO');
  process.exit(1);
});

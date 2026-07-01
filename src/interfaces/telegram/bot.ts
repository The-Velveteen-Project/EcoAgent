// ---
// 📚 POR QUÉ: Punto de inicialización del bot separado de la lógica de handlers.
//    NO inicializa servicios aquí — los recibe por parámetro (DI). Esto permite
//    testear el bot con mocks, cambiar servicios sin tocar el wiring de Grammy,
//    y mantener un solo lugar donde se registran middlewares y comandos.
// 📁 ARCHIVO: src/interfaces/telegram/bot.ts
// ---

import { Bot } from 'grammy';
import { hydrateFiles } from '@grammyjs/files';
import OpenAI from 'openai';
import type { EcoAgentContext } from './middleware/authMiddleware.js';
import { createAuthMiddleware } from './middleware/authMiddleware.js';
import {
  handleStart,
  handleClima,
  handleConfigurar,
  handleUmbral,
  handleAyuda,
  handleModelo,
} from './handlers/commandHandlers.js';
import { handleText } from './handlers/textHandler.js';
import type { RiskAnalysisUseCase } from '../../application/RiskAnalysisUseCase.js';
import type { ModelExplanationUseCase } from '../../application/ModelExplanationUseCase.js';
import type { ISessionRepository } from '../../infrastructure/session/SessionRepository.js';
import type { IWeatherService } from '../../domain/ports/IWeatherService.js';
import type { ISimulationEngine } from '../../domain/ports/ISimulationEngine.js';
import type { IVoiceService } from '../../domain/ports/IVoiceService.js';
import { logger } from '../../config/logger.js';

export interface BotDependencies {
  readonly token: string;
  readonly allowedUserIds: readonly number[];
  readonly sessionRepo: ISessionRepository;
  readonly riskAnalysis: RiskAnalysisUseCase;
  readonly modelExplanation: ModelExplanationUseCase;
  readonly openai: OpenAI;
  readonly weatherService: IWeatherService;
  readonly simulationEngine: ISimulationEngine;
  readonly voiceService: IVoiceService;
}

/**
 * Creates and configures the Grammy bot with all middleware and handlers.
 * Does NOT start the bot — call bot.start() separately.
 */
export function createBot(deps: BotDependencies): Bot<EcoAgentContext> {
  const bot = new Bot<EcoAgentContext>(deps.token);
  bot.api.config.use(hydrateFiles(bot.token));

  // ── Middleware ──────────────────────────────────────────────
  bot.use(createAuthMiddleware(deps.sessionRepo, deps.allowedUserIds));

  // ── Commands ───────────────────────────────────────────────
  bot.command('start', handleStart());
  bot.command('clima', handleClima(deps.riskAnalysis));
  bot.command('configurar', handleConfigurar(deps.sessionRepo));
  bot.command('umbral', handleUmbral(deps.sessionRepo));
  bot.command('ayuda', handleAyuda());
  bot.command('modelo', handleModelo(deps.modelExplanation));

  // ── Natural Language (Agent) Handler ───────────────────────
  bot.on('message:text', handleText(
    deps.openai,
    deps.weatherService,
    deps.simulationEngine,
    deps.voiceService,
    deps.sessionRepo
  ));

  // ── Error handler ──────────────────────────────────────────
  bot.catch((err) => {
    logger.error({ err: err.error, update: err.ctx.update }, 'Unhandled bot error');
  });

  return bot;
}

/**
 * Starts the bot with long-polling.
 */
export async function startBot(bot: Bot<EcoAgentContext>): Promise<void> {
  logger.info('Starting ALLO Telegram bot (long-polling)...');
  bot.start({
    onStart: (botInfo) => {
      logger.info({ username: botInfo.username }, 'ALLO bot connected to Telegram');
    },
  });
}

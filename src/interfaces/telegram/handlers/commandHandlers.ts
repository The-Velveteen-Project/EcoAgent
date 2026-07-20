// ---
// 📚 WHY: Handles all Telegram bot commands in a structured way.
//    Each handler receives its dependencies as parameters (no global module
//    imports), which lets every command be tested in isolation. Alert emojis
//    are consistent across the platform: 🟢 LOW, 🟡 MEDIUM, 🟠 HIGH, 🔴 CRITICAL.
//    User-facing copy is bilingual: the reply follows the user's configured
//    language (settings.language), defaulting to English before an account
//    is linked.
// 📁 FILE: src/interfaces/telegram/handlers/commandHandlers.ts
// ---

import { InputFile } from 'grammy';
import type { EcoAgentContext } from '../middleware/authMiddleware.js';
import type { RiskAnalysisUseCase } from '../../../application/RiskAnalysisUseCase.js';
import type { ModelExplanationUseCase } from '../../../application/ModelExplanationUseCase.js';
import type { ISessionRepository } from '../../../infrastructure/session/SessionRepository.js';
import type { AlertThreshold } from '../../../domain/models/UserSession.js';
import { logger } from '../../../config/logger.js';

const ALERT_EMOJI: Record<AlertThreshold, string> = {
  LOW: '🟢',
  MEDIUM: '🟡',
  HIGH: '🟠',
  CRITICAL: '🔴',
};

// ── /start ───────────────────────────────────────────────────
export function handleStart() {
  return async (ctx: EcoAgentContext): Promise<void> => {
    const name = ctx.from?.first_name ?? 'there';
    const chatId = ctx.chat?.id?.toString() ?? 'ID_UNAVAILABLE';

    // No session yet at /start (account not linked): follow the Telegram
    // client language, defaulting to English.
    const isEs = ctx.from?.language_code?.startsWith('es') ?? false;

    if (isEs) {
      await ctx.reply(
        `¡Hola ${name}! 👋\n\n` +
        `Soy *ALLO*, un observatorio adaptativo para monitoreo estocástico del riesgo de deslizamientos relacionado con clima.\n\n` +
        `🛡️ Esta es una plataforma privada. Para activar tu cuenta, ve al Panel Web y vincula este código:\n\n` +
        `🆔 **Código de Vinculación:** \`${chatId}\`\n\n` +
        `Una vez vinculado, podrás usar:\n` +
        `/clima — Análisis de riesgo en tiempo real\n` +
        `/configurar — Ajustes de voz y alertas\n` +
        `/modelo — Explicación científica del sistema`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `Hi ${name}! 👋\n\n` +
        `I'm *ALLO*, an adaptive observatory for stochastic monitoring of climate-related landslide risk.\n\n` +
        `🛡️ This is a private platform. To activate your account, open the Web Dashboard and link this code:\n\n` +
        `🆔 **Linking Code:** \`${chatId}\`\n\n` +
        `Once linked, you can use:\n` +
        `/clima — Real-time risk analysis\n` +
        `/configurar — Voice and alert settings\n` +
        `/modelo — Scientific explanation of the system`,
        { parse_mode: 'Markdown' }
      );
    }
  };
}

// ── /clima ───────────────────────────────────────────────────
export function handleClima(riskAnalysis: RiskAnalysisUseCase) {
  return async (ctx: EcoAgentContext): Promise<void> => {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    try {
      await ctx.replyWithChatAction('typing');

      const report = await riskAnalysis.analyzeRisk(chatId);
      const emoji = ALERT_EMOJI[report.alert_level];
      const isEn = ctx.session?.settings.language !== 'es';

      let message = isEn
        ? `🎲 *Stochastic CIR Simulation (Euler-Maruyama)*\n` +
          `📍 Manizales, Caldas\n\n` +
          `📊 *Weather Data:*\n` +
          `• Temp: ${report.weather.temperature_c}°C\n` +
          `• Rainfall: ${report.weather.precipitation_mm}mm\n` +
          `• Humidity: ${report.weather.humidity_pct}%\n` +
          `• Wind: ${report.weather.wind_speed_kmh}km/h\n\n` +
          `${emoji} *Risk Level: ${report.alert_level}*\n` +
          `📈 Probability: ${(report.simulation.risk_probability * 100).toFixed(1)}%\n` +
          `📉 Mean saturation: ${report.simulation.mean_saturation.toFixed(4)} ± ${report.simulation.std_saturation.toFixed(4)}`
        : `🎲 *Simulación Estocástica CIR (Euler-Maruyama)*\n` +
          `📍 Manizales, Caldas\n\n` +
          `📊 *Datos Meteorológicos:*\n` +
          `• Temp: ${report.weather.temperature_c}°C\n` +
          `• Precipitación: ${report.weather.precipitation_mm}mm\n` +
          `• Humedad: ${report.weather.humidity_pct}%\n` +
          `• Viento: ${report.weather.wind_speed_kmh}km/h\n\n` +
          `${emoji} *Nivel de Riesgo: ${report.alert_level}*\n` +
          `📈 Probabilidad: ${(report.simulation.risk_probability * 100).toFixed(1)}%\n` +
          `📉 Saturación media: ${report.simulation.mean_saturation.toFixed(4)} ± ${report.simulation.std_saturation.toFixed(4)}`;

      if (report.ai_summary) {
        message += isEn
          ? `\n\n💡 *Executive Summary (AI)*:\n${report.ai_summary}`
          : `\n\n💡 *Resumen Ejecutivo (IA)*:\n${report.ai_summary}`;
      }

      await ctx.reply(message, { parse_mode: 'Markdown' });

      // If voice buffer is available, send as voice message
      if (report.audio_buffer) {
        await ctx.replyWithVoice(
          new InputFile(report.audio_buffer, 'alerta_allo.mp3')
        );
      }
    } catch (err: unknown) {
      logger.error({ err, chatId }, 'Error in /clima command');
      const isEn = ctx.session?.settings.language !== 'es';
      await ctx.reply(
        isEn
          ? "I can't retrieve real-time data right now. " +
            'Please try again in a few minutes.'
          : 'No puedo obtener datos en tiempo real en este momento. ' +
            'Intenta de nuevo en unos minutos.'
      );
    }
  };
}

// ── /configurar ──────────────────────────────────────────────
export function handleConfigurar(sessionRepo: ISessionRepository) {
  return async (ctx: EcoAgentContext): Promise<void> => {
    const session = ctx.session;
    if (!session) return;

    const s = session.settings;
    const emoji = ALERT_EMOJI[s.alert_threshold];
    const isEn = s.language !== 'es';

    await ctx.reply(
      isEn
        ? `⚙️ *Your Current Settings*\n\n` +
          `${emoji} Alert threshold: *${s.alert_threshold}*\n` +
          `📍 Location: ${s.location_lat}, ${s.location_lon}\n` +
          `🔊 Voice: ${s.voice_enabled ? 'Enabled' : 'Disabled'}\n` +
          `🌐 Language: ${s.language}\n` +
          `⏰ Report frequency: every ${s.report_frequency_hours}h\n\n` +
          `To change your alert threshold, send:\n` +
          `\`/umbral LOW\`, \`/umbral MEDIUM\`, \`/umbral HIGH\`, or \`/umbral CRITICAL\``
        : `⚙️ *Tu Configuración Actual*\n\n` +
          `${emoji} Umbral de alerta: *${s.alert_threshold}*\n` +
          `📍 Ubicación: ${s.location_lat}, ${s.location_lon}\n` +
          `🔊 Voz: ${s.voice_enabled ? 'Habilitada' : 'Deshabilitada'}\n` +
          `🌐 Idioma: ${s.language}\n` +
          `⏰ Frecuencia de reportes: cada ${s.report_frequency_hours}h\n\n` +
          `Para cambiar tu umbral de alerta, envía:\n` +
          `\`/umbral LOW\`, \`/umbral MEDIUM\`, \`/umbral HIGH\`, o \`/umbral CRITICAL\``,
      { parse_mode: 'Markdown' }
    );
  };
}

// ── /umbral [LEVEL] ──────────────────────────────────────────
export function handleUmbral(sessionRepo: ISessionRepository) {
  return async (ctx: EcoAgentContext): Promise<void> => {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    const text = ctx.message?.text ?? '';
    const newLevel = text.replace('/umbral', '').trim().toUpperCase();
    const validLevels: AlertThreshold[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const isEn = ctx.session?.settings.language !== 'es';

    if (!validLevels.includes(newLevel as AlertThreshold)) {
      await ctx.reply(
        isEn
          ? 'Invalid level. Use: `/umbral LOW`, `/umbral MEDIUM`, `/umbral HIGH`, or `/umbral CRITICAL`'
          : 'Nivel inválido. Usa: `/umbral LOW`, `/umbral MEDIUM`, `/umbral HIGH`, o `/umbral CRITICAL`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await sessionRepo.updateSettings(chatId, {
      alert_threshold: newLevel as AlertThreshold,
    });

    const emoji = ALERT_EMOJI[newLevel as AlertThreshold];
    await ctx.reply(
      isEn
        ? `${emoji} Alert threshold updated to *${newLevel}*`
        : `${emoji} Umbral de alerta actualizado a *${newLevel}*`,
      { parse_mode: 'Markdown' }
    );
  };
}

// ── /modelo ───────────────────────────────────────────────────
export function handleModelo(modelExplanation: ModelExplanationUseCase) {
  return async (ctx: EcoAgentContext): Promise<void> => {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    try {
      await ctx.replyWithChatAction('typing');
      const explanation = await modelExplanation.explainModel(chatId);
      await ctx.reply(explanation, { parse_mode: 'Markdown' });
    } catch (err: unknown) {
      logger.error({ err, chatId }, 'Error in /modelo command');
      const isEn = ctx.session?.settings.language === 'en';
      await ctx.reply(
        isEn
          ? 'Failed to generate model explanation.'
          : 'No se pudo generar la explicación del modelo.'
      );
    }
  };
}

// ── /ayuda ───────────────────────────────────────────────────
export function handleAyuda() {
  return async (ctx: EcoAgentContext): Promise<void> => {
    const isEn = ctx.session?.settings.language === 'en';

    if (isEn) {
      await ctx.reply(
        `📖 *ALLO Commands*\n\n` +
        `/clima — Real-time risk analysis with CIR simulation\n` +
        `/modelo — Explains the underlying mathematical model\n` +
        `/configurar — View your current settings\n` +
        `/umbral [LEVEL] — Change alert threshold (LOW/MEDIUM/HIGH/CRITICAL)\n` +
        `/ayuda — This list of commands\n\n` +
        `📍 Currently monitoring: *Manizales, Colombia*`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `📖 *Comandos de ALLO*\n\n` +
        `/clima — Análisis de riesgo en tiempo real con simulación CIR\n` +
        `/modelo — Explica el modelo matemático de fondo\n` +
        `/configurar — Ver tu configuración actual\n` +
        `/umbral [NIVEL] — Cambiar umbral de alerta (LOW/MEDIUM/HIGH/CRITICAL)\n` +
        `/ayuda — Esta lista de comandos\n\n` +
        `📍 Monitoreando actualmente: *Manizales, Colombia*`,
        { parse_mode: 'Markdown' }
      );
    }
  };
}

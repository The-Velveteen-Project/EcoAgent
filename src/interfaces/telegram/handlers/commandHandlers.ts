// ---
// 📚 POR QUÉ: Maneja todos los comandos del bot de Telegram de forma estructurada.
//    Cada handler recibe las dependencias por parámetro (no importa módulos globales),
//    lo que permite testear cada comando en aislamiento. Los emojis de alerta son
//    consistentes en toda la plataforma: 🟢 LOW, 🟡 MEDIUM, 🟠 HIGH, 🔴 CRITICAL.
// 📁 ARCHIVO: src/interfaces/telegram/handlers/commandHandlers.ts
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
    const name = ctx.from?.first_name ?? 'usuario';

    const chatId = ctx.chat?.id?.toString() ?? 'ID_NO_DISPONIBLE';

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

      let message =
        `🎲 *Simulación Estocástica CIR (Euler-Maruyama)*\n` +
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
        message += `\n\n💡 *Resumen Ejecutivo (IA)*:\n${report.ai_summary}`;
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
      await ctx.reply(
        'No puedo obtener datos en tiempo real en este momento. ' +
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

    await ctx.reply(
      `⚙️ *Tu Configuración Actual*\n\n` +
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

    if (!validLevels.includes(newLevel as AlertThreshold)) {
      await ctx.reply(
        'Nivel inválido. Usa: `/umbral LOW`, `/umbral MEDIUM`, `/umbral HIGH`, o `/umbral CRITICAL`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await sessionRepo.updateSettings(chatId, {
      alert_threshold: newLevel as AlertThreshold,
    });

    const emoji = ALERT_EMOJI[newLevel as AlertThreshold];
    await ctx.reply(`${emoji} Umbral de alerta actualizado a *${newLevel}*`, {
      parse_mode: 'Markdown',
    });
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

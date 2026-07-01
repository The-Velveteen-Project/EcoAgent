// ---
// 📚 POR QUÉ: Implementa el cerebro del Agente de IA. Recibe el texto en lenguaje
//    natural, lo procesa usando OpenRouter (OpenAI SDK), inyecta el SystemPrompt
//    con contexto de la sesión, y ejecuta comandos (Function Calling) dinámicamente.
// 📁 ARCHIVO: src/interfaces/telegram/handlers/textHandler.ts
// ---

import OpenAI from 'openai';
import { InputFile } from 'grammy';
import type { EcoAgentContext } from '../middleware/authMiddleware.js';
import { buildSystemPrompt } from '../../../application/prompts/buildSystemPrompt.js';
import { agentTools } from '../../../application/tools/agentTools.js';
import type { IWeatherService } from '../../../domain/ports/IWeatherService.js';
import type { ISimulationEngine } from '../../../domain/ports/ISimulationEngine.js';
import type { IVoiceService } from '../../../domain/ports/IVoiceService.js';
import type { ISessionRepository } from '../../../infrastructure/session/SessionRepository.js';
import { logger } from '../../../config/logger.js';
import { settings as appSettings } from '../../../config/settings.js';

export function handleText(
  openai: OpenAI,
  weatherService: IWeatherService,
  simulationEngine: ISimulationEngine,
  voiceService: IVoiceService,
  sessionRepo: ISessionRepository
) {
  return async (ctx: EcoAgentContext): Promise<void> => {
    const session = ctx.session;
    const text = ctx.message?.text;
    const chatId = ctx.chat?.id?.toString();

    if (!session || !text || !chatId) return;

    // Reject commands if they somehow fall through
    if (text.startsWith('/')) return;

    try {
      await ctx.replyWithChatAction('typing');

      const systemPrompt = buildSystemPrompt(session);

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        // For MVP, just the user's latest query is sent.
        // History could be retrieved from sessionRepo in future iterations.
        { role: 'user', content: text },
      ];

      let response = await openai.chat.completions.create({
        model: appSettings.OPENROUTER_MODEL,
        messages,
        tools: agentTools as OpenAI.Chat.ChatCompletionTool[],
        tool_choice: 'auto',
      });

      let responseMessage = response.choices[0]?.message;

      // Handle function calling loop
      while (
        responseMessage &&
        responseMessage.tool_calls &&
        responseMessage.tool_calls.length > 0
      ) {
        messages.push(responseMessage); // Append assistant's tool call

        for (const toolCall of responseMessage.tool_calls) {
          logger.info({ function: toolCall.function.name }, 'LLM invoked tool');
          let toolResult = '';

          try {
            if (toolCall.function.name === 'get_weather') {
              const weather = await weatherService.getCurrentWeather(
                session.settings.location_lat,
                session.settings.location_lon
              );
              toolResult = JSON.stringify(weather);
            } else if (toolCall.function.name === 'simulate_risk') {
              const weather = await weatherService.getCurrentWeather(
                session.settings.location_lat,
                session.settings.location_lon
              );
              const args = JSON.parse(toolCall.function.arguments);
              const sim = await simulationEngine.simulate({
                precipitation_mm: weather.precipitation_mm,
                humidity_pct: weather.humidity_pct,
                temperature_c: weather.temperature_c,
                n_simulations: args.n_simulations || 1000,
                time_horizon_hours: args.time_horizon_hours || 24,
              });
              toolResult = JSON.stringify(sim);
            } else if (toolCall.function.name === 'send_voice_report') {
              const args = JSON.parse(toolCall.function.arguments);
              const buffer = await voiceService.synthesize(args.summary_text);
              if (buffer) {
                await ctx.replyWithVoice(new InputFile(buffer, 'allo_voice.mp3'));
                toolResult = 'OK: Audio report explicitly sent to user.';
              } else {
                toolResult = 'ERROR: Could not generate audio at this time.';
              }
            } else if (toolCall.function.name === 'get_user_settings') {
              toolResult = JSON.stringify(session.settings);
            } else if (toolCall.function.name === 'update_alert_threshold') {
              const args = JSON.parse(toolCall.function.arguments);
              await sessionRepo.updateSettings(chatId, {
                alert_threshold: args.threshold,
              });
              toolResult = `OK: Alert threshold updated to ${args.threshold}.`;
            } else {
              toolResult = `ERROR: Tool ${toolCall.function.name} not defined.`;
            }
          } catch (err: unknown) {
            const e = err as Error;
            logger.error({ err: e, tool: toolCall.function.name }, 'Tool execution error');
            toolResult = `ERROR: ${e.message}`;
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          });
        }

        // Call the LLM again with the tool outputs
        await ctx.replyWithChatAction('typing');
        response = await openai.chat.completions.create({
          model: appSettings.OPENROUTER_MODEL,
          messages,
          tools: agentTools as OpenAI.Chat.ChatCompletionTool[],
          tool_choice: 'auto',
        });
        responseMessage = response.choices[0]?.message;
      }

      // Final response delivery
      if (responseMessage && responseMessage.content) {
        await ctx.reply(responseMessage.content, { parse_mode: 'Markdown' });
        
        // Save conversation context to DB
        await sessionRepo.appendMessage(chatId, {
          role: 'user',
          content: text,
          timestamp: new Date(),
        });
        await sessionRepo.appendMessage(chatId, {
          role: 'assistant',
          content: responseMessage.content,
          timestamp: new Date(),
        });
      }
    } catch (err: unknown) {
      logger.error({ err }, 'Error in textHandler LLM process');
      await ctx.reply(
        'Lo siento, estoy teniendo problemas conectándome con mi cerebro (LLM). ' +
        'Intenta de nuevo más tarde.'
      );
    }
  };
}

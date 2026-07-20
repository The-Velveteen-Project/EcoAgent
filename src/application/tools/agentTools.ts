// ---
// 📚 WHY: Defines the agent's tools in OpenAI function-calling format.
//    These definitions tell the LLM WHICH tools exist and WHEN to use them.
//    Without precise descriptions that include "MUST be called before...", the LLM
//    would answer from its training data instead of invoking real data. The
//    descriptions are prescriptive, not descriptive — they are instructions, not
//    documentation.
// 📁 FILE: src/application/tools/agentTools.ts
// ---

import type { ChatCompletionTool } from 'openai/resources/chat/completions.js';

/**
 * OpenAI function-calling tool definitions for ALLO.
 * Descriptions are intentionally prescriptive to force tool use.
 */
export const agentTools: readonly ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description:
        'Retrieves current, real-time weather conditions for the user location. ' +
        'MUST be called before any mention of temperature, rainfall, humidity, or weather conditions. ' +
        'Takes no parameters — uses the user\'s configured coordinates.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'simulate_risk',
      description:
        'Runs the stochastic CIR (Cox-Ingersoll-Ross) landslide-risk simulation. ' +
        'MUST be called before any mention of a risk level, soil-failure probability, ' +
        'or saturation. Uses real weather data internally.',
      parameters: {
        type: 'object',
        properties: {
          n_simulations: {
            type: 'number',
            description: 'Number of Monte Carlo simulations (1–10000). Default: 1000.',
          },
          time_horizon_hours: {
            type: 'number',
            description: 'Time horizon in hours for the projection. Default: 24.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_voice_report',
      description:
        'Generates and sends a voice report to the user using text-to-speech. ' +
        'Useful for urgent alerts or when the user prefers an audio format.',
      parameters: {
        type: 'object',
        properties: {
          summary_text: {
            type: 'string',
            description: 'Summary text to convert to voice.',
          },
        },
        required: ['summary_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_user_settings',
      description:
        'Reads the user\'s current settings: alert threshold, location, language, ' +
        'and voice preferences. Takes no parameters.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_alert_threshold',
      description:
        'Updates the user\'s alert threshold. Valid values are: LOW, MEDIUM, HIGH, CRITICAL.',
      parameters: {
        type: 'object',
        properties: {
          threshold: {
            type: 'string',
            enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
            description: 'New alert threshold.',
          },
        },
        required: ['threshold'],
      },
    },
  },
] as const;

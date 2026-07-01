// ---
// 📚 POR QUÉ: Define las herramientas del agente en formato OpenAI function calling.
//    Estas definiciones le dicen al LLM QUÉ herramientas existen y CUÁNDO usarlas.
//    Sin descripciones precisas que incluyan "DEBE llamarse antes de...", el LLM
//    contestará desde su training data en lugar de invocar datos reales. Las descripciones
//    son prescriptivas, no descriptivas — son instrucciones, no documentación.
// 📁 ARCHIVO: src/application/tools/agentTools.ts
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
        'Obtiene condiciones climáticas actuales en tiempo real para la ubicación del usuario. ' +
        'DEBE llamarse antes de cualquier mención de temperatura, lluvia, humedad o condiciones climáticas. ' +
        'No requiere parámetros — usa las coordenadas configuradas del usuario.',
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
        'Ejecuta simulación estocástica CIR (Cox-Ingersoll-Ross) de riesgo de deslizamiento. ' +
        'DEBE llamarse antes de cualquier mención de nivel de riesgo, probabilidad de fallo del suelo, ' +
        'o saturación. Usa datos meteorológicos reales internamente.',
      parameters: {
        type: 'object',
        properties: {
          n_simulations: {
            type: 'number',
            description: 'Número de simulaciones Monte Carlo (1–10000). Default: 1000.',
          },
          time_horizon_hours: {
            type: 'number',
            description: 'Horizonte temporal en horas para la proyección. Default: 24.',
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
        'Genera y envía un reporte por voz al usuario usando síntesis de texto a voz. ' +
        'Útil para alertas urgentes o cuando el usuario prefiere formato de audio.',
      parameters: {
        type: 'object',
        properties: {
          summary_text: {
            type: 'string',
            description: 'Texto del resumen a convertir en voz.',
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
        'Consulta la configuración actual del usuario: umbral de alerta, ubicación, idioma, ' +
        'y preferencias de voz. No requiere parámetros.',
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
        'Actualiza el umbral de alerta del usuario. Los valores válidos son: LOW, MEDIUM, HIGH, CRITICAL.',
      parameters: {
        type: 'object',
        properties: {
          threshold: {
            type: 'string',
            enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
            description: 'Nuevo umbral de alerta.',
          },
        },
        required: ['threshold'],
      },
    },
  },
] as const;

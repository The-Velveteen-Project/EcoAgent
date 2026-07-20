// ---
// 📚 WHY: Replaces all console.log/console.error with a structured logger.
//    In production, JSON logs are parseable by tools like Railway, Datadog, etc.
//    In development, pino-pretty formats them to be readable. Without this, logs are plain text
//    with no timestamps, levels, or context — impossible to filter or search.
// 📁 FILE: src/config/logger.ts
// ---

import pino from 'pino';
import { settings } from './settings.js';

const isDev = settings.NODE_ENV === 'development';

/**
 * Singleton structured logger for the entire application.
 * - Development: human-readable via pino-pretty
 * - Production: JSON lines for log aggregation services
 */
export const logger = isDev
  ? pino({
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
      base: {
        service: 'ecoagent-bot',
        version: process.env.npm_package_version ?? 'unknown',
      },
    })
  : pino({
      level: 'info',
      base: {
        service: 'ecoagent-bot',
        version: process.env.npm_package_version ?? 'unknown',
      },
    });

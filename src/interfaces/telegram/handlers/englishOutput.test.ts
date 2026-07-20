// ---
// 📚 WHY: Verifies that when a user's session language is 'en', every command
//    handler replies in English. Guards the bilingual routing so a future
//    refactor cannot silently drop the English branch.
// 📁 FILE: src/interfaces/telegram/handlers/englishOutput.test.ts
// ---

import { describe, it, expect, vi } from 'vitest';

// The handlers import the logger, which imports settings and validates env vars
// (calling process.exit on failure). Mock settings so the suite runs without a
// populated .env — same pattern as the other handler/use-case tests.
vi.mock('../../../config/settings.js', () => ({
  settings: {
    TELEGRAM_BOT_TOKEN: 'test',
    OPENROUTER_API_KEY: 'test',
    OPENROUTER_MODEL: 'test',
    ELEVENLABS_API_KEY: 'test',
    ELEVENLABS_VOICE_ID: 'test',
    LOG_LEVEL: 'silent',
  },
}));

import {
  handleClima,
  handleConfigurar,
  handleUmbral,
  handleModelo,
  handleStart,
} from './commandHandlers.js';
import type { UserSession } from '../../../domain/models/UserSession.js';

function enSession(): UserSession {
  return {
    telegram_chat_id: 'chat-en',
    user_id: 'user-en',
    settings: {
      alert_threshold: 'HIGH',
      location_lat: 5.0703,
      location_lon: -75.5138,
      language: 'en',
      voice_enabled: false,
      report_frequency_hours: 6,
    },
    conversation_history: [],
  };
}

// Minimal Grammy-context stub that records reply() text.
function makeCtx(session: UserSession | undefined, text = '') {
  const replies: string[] = [];
  return {
    ctx: {
      session,
      chat: { id: 12345 },
      from: { first_name: 'Alex', language_code: 'en' },
      message: { text },
      reply: vi.fn(async (m: string) => { replies.push(m); }),
      replyWithChatAction: vi.fn(async () => {}),
      replyWithVoice: vi.fn(async () => {}),
    } as any,
    replies,
  };
}

const SPANISH = /(Configuraci\u00f3n|Umbral|Nivel|inv\u00e1lido|Precipitaci\u00f3n|Saturaci\u00f3n|Ubicaci\u00f3n|C\u00f3digo|conf\u00edas|explicaci\u00f3n|actualizado|riesgo en tiempo real|no puedo|Datos Meteorol)/;

describe('bot replies in English when language = en', () => {
  it('/start greets in English', async () => {
    const { ctx, replies } = makeCtx(undefined, '/start');
    await handleStart()(ctx);
    expect(replies[0]).toContain('Hi Alex');
    expect(replies[0]).toContain('Linking Code');
    expect(replies[0]).not.toMatch(SPANISH);
  });

  it('/clima error message is English', async () => {
    const ra = { analyzeRisk: vi.fn(async () => { throw new Error('boom'); }) } as any;
    const { ctx, replies } = makeCtx(enSession(), '/clima');
    await handleClima(ra)(ctx);
    expect(replies[0]).toContain("I can't retrieve real-time data");
    expect(replies[0]).not.toMatch(SPANISH);
  });

  it('/clima report is English', async () => {
    const ra = { analyzeRisk: vi.fn(async () => ({
      alert_level: 'HIGH',
      weather: { temperature_c: 18, precipitation_mm: 12, humidity_pct: 80, wind_speed_kmh: 5 },
      simulation: { risk_probability: 0.42, mean_saturation: 0.5, std_saturation: 0.1 },
      ai_summary: 'Stable.', audio_buffer: null,
    })) } as any;
    const { ctx, replies } = makeCtx(enSession(), '/clima');
    await handleClima(ra)(ctx);
    expect(replies[0]).toContain('Weather Data');
    expect(replies[0]).toContain('Risk Level');
    expect(replies[0]).toContain('Executive Summary');
    expect(replies[0]).not.toMatch(SPANISH);
  });

  it('/configurar shows settings in English', async () => {
    const { ctx, replies } = makeCtx(enSession());
    await handleConfigurar({} as any)(ctx);
    expect(replies[0]).toContain('Your Current Settings');
    expect(replies[0]).toContain('Alert threshold');
    expect(replies[0]).not.toMatch(SPANISH);
  });

  it('/umbral invalid + valid are English', async () => {
    const repo = { updateSettings: vi.fn(async () => {}) } as any;
    const bad = makeCtx(enSession(), '/umbral FOO');
    await handleUmbral(repo)(bad.ctx);
    expect(bad.replies[0]).toContain('Invalid level');
    expect(bad.replies[0]).not.toMatch(SPANISH);
    const ok = makeCtx(enSession(), '/umbral LOW');
    await handleUmbral(repo)(ok.ctx);
    expect(ok.replies[0]).toContain('Alert threshold updated');
    expect(ok.replies[0]).not.toMatch(SPANISH);
  });

  it('/modelo error is English', async () => {
    const me = { explainModel: vi.fn(async () => { throw new Error('x'); }) } as any;
    const { ctx, replies } = makeCtx(enSession(), '/modelo');
    await handleModelo(me)(ctx);
    expect(replies[0]).toBe('Failed to generate model explanation.');
  });
});

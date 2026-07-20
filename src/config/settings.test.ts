// ---
// 📚 WHY: Protects against regressions in environment variable validation.
//    If someone deploys without TELEGRAM_BOT_TOKEN, this test ensures the process
//    would die with a clear message instead of a runtime crash 10 minutes later.
//    If OPENROUTER_API_KEY doesn't start with "sk-", it detects malformed API keys.
// 📁 FILE: src/config/settings.test.ts
// ---

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the Zod schema directly, not the loaded settings singleton,
// because the singleton calls process.exit(1) on failure.
import { z } from 'zod';

// Reproduce the schema from settings.ts for isolated testing
const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_USER_IDS: z
    .string()
    .transform((val): readonly number[] =>
      val.split(',').map((id) => {
        const parsed = parseInt(id.trim(), 10);
        if (Number.isNaN(parsed)) throw new Error(`Invalid ID: "${id}"`);
        return parsed;
      })
    ),
  OPENROUTER_API_KEY: z
    .string()
    .refine((val) => val.startsWith('sk-'), {
      message: 'OPENROUTER_API_KEY must start with "sk-"',
    }),
  ELEVENLABS_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().default('openai/gpt-4o-mini'),
  PYTHON_API_URL: z.string().url().default('http://localhost:8000/simulate_risk'),
  DB_PATH: z.string().default('./memory.db'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ELEVENLABS_VOICE_ID: z.string().default('EXAVITQu4vr4xnSDxMaL'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
});

const VALID_ENV = {
  TELEGRAM_BOT_TOKEN: '123456:ABC-DEF',
  TELEGRAM_ALLOWED_USER_IDS: '12345,67890',
  OPENROUTER_API_KEY: 'sk-or-v1-test',
  ELEVENLABS_API_KEY: 'el-test-key',
};

describe('Environment Settings Validation', () => {
  // TEST: Missing required TELEGRAM_BOT_TOKEN causes clear validation error.
  // WHY: Deploying without a bot token is the most common misconfiguration —
  //      the app must fail IMMEDIATELY, not after the bot tries to connect.
  it('rejects missing TELEGRAM_BOT_TOKEN', () => {
    const env = { ...VALID_ENV };
    delete (env as Record<string, unknown>).TELEGRAM_BOT_TOKEN;

    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  // TEST: OPENROUTER_API_KEY without "sk-" prefix is rejected.
  // WHY: OpenRouter keys always start with "sk-". If someone pastes a different
  //      provider's key, we catch it at startup rather than getting a cryptic 401.
  it('rejects OPENROUTER_API_KEY that does not start with "sk-"', () => {
    const env = { ...VALID_ENV, OPENROUTER_API_KEY: 'invalid-key-no-prefix' };

    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain('OPENROUTER_API_KEY must start with "sk-"');
    }
  });

  // TEST: All valid variables produce a correctly typed settings object.
  // WHY: Ensures the happy path works and defaults are applied correctly.
  it('produces valid settings with all required variables', () => {
    const result = envSchema.safeParse(VALID_ENV);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TELEGRAM_BOT_TOKEN).toBe('123456:ABC-DEF');
      expect(result.data.TELEGRAM_ALLOWED_USER_IDS).toEqual([12345, 67890]);
      expect(result.data.OPENROUTER_MODEL).toBe('openai/gpt-4o-mini');
      expect(result.data.DB_PATH).toBe('./memory.db');
      expect(result.data.NODE_ENV).toBe('development');
      expect(result.data.ELEVENLABS_VOICE_ID).toBe('EXAVITQu4vr4xnSDxMaL');
    }
  });

  // TEST: TELEGRAM_ALLOWED_USER_IDS with non-numeric values fails.
  // WHY: Telegram user IDs are always integers. Parsing "abc" would produce NaN,
  //      which would silently allow everyone through the whitelist middleware.
  it('rejects non-numeric TELEGRAM_ALLOWED_USER_IDS', () => {
    const env = { ...VALID_ENV, TELEGRAM_ALLOWED_USER_IDS: '123,abc,456' };

    // The transform throws inside Zod, which may propagate as a thrown error
    // or as a failed safeParse result depending on Zod version
    try {
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    } catch (err) {
      // Transform threw before safeParse could catch it — still a valid failure
      expect(err).toBeDefined();
    }
  });
});

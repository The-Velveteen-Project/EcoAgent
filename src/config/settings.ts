// ---
// 📚 WHY: Centralizes and validates ALL environment variables at startup using Zod.
//    Without this, missing or malformed variables cause cryptic runtime crashes
//    (e.g., "Cannot read property of undefined" at 3am in production).
//    With Zod, the process dies immediately with an exhaustive list of what is missing.
// 📁 FILE: src/config/settings.ts
// ---

import { z } from 'zod';

const envSchema = z.object({
  // ── Required: Telegram ─────────────────────────────────────
  TELEGRAM_BOT_TOKEN: z
    .string({ required_error: 'TELEGRAM_BOT_TOKEN is required' })
    .min(1, 'TELEGRAM_BOT_TOKEN cannot be empty'),

  TELEGRAM_ALLOWED_USER_IDS: z
    .string()
    .optional()
    .default('')
    .transform((val): readonly number[] => {
      if (!val) return [];
      return val.split(',').map((id) => {
        const parsed = parseInt(id.trim(), 10);
        if (Number.isNaN(parsed)) {
          throw new Error(`Invalid Telegram user ID: "${id}"`);
        }
        return parsed;
      });
    }),

  // ── Required: OpenRouter ───────────────────────────────────
  OPENROUTER_API_KEY: z
    .string({ required_error: 'OPENROUTER_API_KEY is required' })
    .refine((val) => val.startsWith('sk-'), {
      message: 'OPENROUTER_API_KEY must start with "sk-"',
    }),

  // ── Required: ElevenLabs ───────────────────────────────────
  ELEVENLABS_API_KEY: z
    .string({ required_error: 'ELEVENLABS_API_KEY is required' })
    .min(1, 'ELEVENLABS_API_KEY cannot be empty'),

  // ── Optional with defaults ─────────────────────────────────
  OPENROUTER_MODEL: z.string().default('openai/gpt-4o-mini'),

  PYTHON_API_URL: z.string().url().default('http://localhost:8000/simulate_risk'),

  DB_PATH: z.string().default('./memory.db'),

  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  ELEVENLABS_VOICE_ID: z.string().default('EXAVITQu4vr4xnSDxMaL'),

  // ── Optional: Supabase (required for web platform) ─────────
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadAndValidateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    // Using process.stderr directly — logger is not yet initialized at this point
    process.stderr.write(
      `\n╔══════════════════════════════════════════╗\n` +
      `║  FATAL: Environment validation failed    ║\n` +
      `╚══════════════════════════════════════════╝\n\n` +
      `${formatted}\n\n` +
      `Copy .env.example to .env and fill in the required values.\n\n`
    );
    process.exit(1);
  }

  return result.data;
}

/**
 * Validated, typed environment configuration.
 * Accessing any property is guaranteed safe — Zod validated at startup.
 */
export const settings: EnvConfig = loadAndValidateEnv();

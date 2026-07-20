// ---
// 📚 WHY: Verifies the system prompt's anti-hallucination rules are present.
//    If a refactor accidentally deletes the phrase "without first calling
//    get_weather or simulate_risk", the LLM will start inventing weather data.
//    This test is a safety guardrail that prevents regressions in the
//    anti-hallucination defenses.
// 📁 FILE: src/application/prompts/buildSystemPrompt.test.ts
// ---

import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './buildSystemPrompt.js';
import type { UserSession } from '../../domain/models/UserSession.js';

function createMockSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    telegram_chat_id: 'chat-123',
    user_id: 'user-456',
    settings: {
      alert_threshold: 'HIGH',
      location_lat: 5.0703,
      location_lon: -75.5138,
      language: 'es',
      voice_enabled: true,
      report_frequency_hours: 6,
    },
    conversation_history: [],
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  // TEST: Anti-hallucination phrase is ALWAYS present in the generated prompt.
  // WHY: This exact phrase tells the LLM to never cite numeric values without
  //      calling tools first. Removing it would allow the LLM to fabricate
  //      weather data from its training set — dangerous for a safety-critical app.
  it('always contains the anti-hallucination phrase', () => {
    const session = createMockSession();
    const prompt = buildSystemPrompt(session);

    expect(prompt).toContain(
      'without first calling get_weather or simulate_risk'
    );
  });

  // TEST: The prompt includes the user's specific alert_threshold.
  // WHY: The LLM needs to know the user's threshold to provide contextual
  //      advice (e.g., "your threshold is LOW, so you'd be alerted for this").
  it('includes the user alert_threshold', () => {
    const session = createMockSession({
      settings: {
        ...createMockSession().settings,
        alert_threshold: 'CRITICAL',
      },
    });
    const prompt = buildSystemPrompt(session);

    expect(prompt).toContain('CRITICAL');
  });

  // TEST: Two different sessions produce different system prompts.
  // WHY: Each user's prompt must reflect THEIR settings. If the system prompt
  //      is the same for all users, the LLM can't give personalized advice
  //      (wrong location, wrong language, wrong threshold).
  it('generates distinct prompts for different sessions', () => {
    const session1 = createMockSession({
      settings: {
        ...createMockSession().settings,
        alert_threshold: 'LOW',
        location_lat: 4.5,
        location_lon: -74.0,
      },
    });

    const session2 = createMockSession({
      settings: {
        ...createMockSession().settings,
        alert_threshold: 'CRITICAL',
        location_lat: 6.25,
        location_lon: -75.56,
      },
    });

    const prompt1 = buildSystemPrompt(session1);
    const prompt2 = buildSystemPrompt(session2);

    expect(prompt1).not.toBe(prompt2);
    expect(prompt1).toContain('LOW');
    expect(prompt2).toContain('CRITICAL');
    expect(prompt1).toContain('4.5');
    expect(prompt2).toContain('6.25');
  });

  // TEST: Prompt reflects voice_enabled setting.
  // WHY: The LLM should know if voice is enabled so it can suggest using
  //      send_voice_report when appropriate.
  it('includes voice_enabled status', () => {
    const sessionVoiceOn = createMockSession();
    const sessionVoiceOff = createMockSession({
      settings: {
        ...createMockSession().settings,
        voice_enabled: false,
      },
    });

    expect(buildSystemPrompt(sessionVoiceOn)).toContain('Voice enabled: yes');
    expect(buildSystemPrompt(sessionVoiceOff)).toContain('Voice enabled: no');
  });
});

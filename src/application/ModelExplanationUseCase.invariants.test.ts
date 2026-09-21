// ---
// 📚 WHY: The /modelo explainer is the only place where the system tells a human, in prose, what
//    mathematics it is running. A drift between that prose and the engine is not cosmetic: the
//    claim ALLO makes is that the LLM explains and does not compute, and therefore does not
//    hallucinate the model. A prompt describing a different SDE breaks that claim at exactly the
//    layer a reviewer would inspect first.
//
//    This suite pins MODEL_CARD invariant #1 — rainfall is FORCING, never a shift of an
//    equilibrium level the process reverts to — onto the user-facing text layer, not only onto
//    the scientific core. It fails if the legacy Cox-Ingersoll-Ross nomenclature, the mean-shift
//    formulation ('b' rising +0.05 per mm), or the retired 0.6 threshold-crossing rule reappear
//    in either language branch.
// 📁 FILE: src/application/ModelExplanationUseCase.invariants.test.ts
// ---

import { describe, it, expect, vi } from 'vitest';

// The use case module imports settings, which validates env vars and calls process.exit on
// failure. Mock it so the suite runs without a populated .env — same pattern as the sibling tests.
vi.mock('../config/settings.js', () => ({
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
  buildModelExplanationPrompt,
  type ModelExplanationLanguage,
} from './ModelExplanationUseCase.js';

const LANGUAGES: readonly ModelExplanationLanguage[] = ['en', 'es'];

/**
 * Formulations that are scientifically wrong for this system. Each one describes the legacy
 * prototype, not the engine in src/infrastructure/simulation/jacobiModel.ts.
 */
const FORBIDDEN_PATTERNS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: 'CIR acronym', pattern: /\bCIR\b/i },
  { label: 'Cox-Ingersoll-Ross by name', pattern: /Cox.?Ingersoll/i },
  { label: 'mean reversion (en)', pattern: /mean[\s-]*revers/i },
  { label: 'reversión a la media (es)', pattern: /revers[ií][oó]n\s+a\s+la\s+media/i },
  { label: 'square-root diffusion (en)', pattern: /square[\s-]*root\s+diffusion/i },
  { label: 'difusión de raíz cuadrada (es)', pattern: /difusi[oó]n\s+de\s+ra[ií]z\s+cuadrada/i },
  // The mean-shift calibration: 'b' moving by +0.05 for every mm of rainfall.
  { label: "'b' shifted +0.05 per mm of rain", pattern: /0\.05\s*(por|per)?\s*(cada)?\s*mm/i },
  { label: 'sigma * sqrt(Rt) diffusion term', pattern: /(σ|sigma)\s*[*·]?\s*(√|sqrt)\s*\(?\s*Rt/i },
  { label: 'a(b - Rt) mean-reverting drift', pattern: /a\s*\(\s*b\s*[-−]\s*Rt\s*\)/i },
  // The retired rule: a path counted as a failure when saturation crosses a fixed 0.6 level.
  { label: 'retired 0.6 crossing threshold', pattern: /0\.6\b/ },
];

/**
 * Statements the explanation must actually make, in both languages. These are the load-bearing
 * pieces of the real model: the process family, the boundedness argument, the hazard link, the
 * integrated-hazard probability, the alert bands, and the operational A25 anchors.
 */
const REQUIRED_PATTERNS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: 'Jacobi process named', pattern: /Jacobi/i },
  { label: 'bounded state space (0, 1)', pattern: /\(\s*0\s*,\s*1\s*\)/ },
  { label: 'Jacobi diffusion term sqrt(S(1-S))', pattern: /sqrt\s*\(\s*S\s*\*\s*\(\s*1\s*-\s*S\s*\)\s*\)/i },
  { label: 'rainfall as forcing, not a shifted mean', pattern: /(FORCING|FORZAMIENTO)/ },
  { label: 'Michaelis-Menten wetting response', pattern: /Michaelis[\s-]*Menten/i },
  { label: 'rho(R) = R / (R + R_half)', pattern: /rho\s*\(\s*R\s*\)\s*=\s*R\s*\/\s*\(\s*R\s*\+\s*R_half\s*\)/i },
  { label: 'R_half = 30 mm', pattern: /R_half\s*=\s*30\s*mm/i },
  { label: 'hazard link h(S) = h0 * exp(beta * (S - Sc)+)', pattern: /h\s*\(\s*S\s*\)\s*=\s*h0\s*\*\s*exp\s*\(\s*beta\s*\*\s*\(\s*S\s*-\s*Sc\s*\)_\+\s*\)/i },
  { label: 'P = 1 - exp(-integral of h)', pattern: /P\s*=\s*1\s*-\s*exp\s*\(\s*-\s*integral/i },
  { label: 'calibrated h0', pattern: /h0\s*=\s*0\.000217/ },
  { label: 'calibrated beta', pattern: /beta\s*=\s*8\.30/ },
  { label: 'calibrated Sc', pattern: /Sc\s*=\s*0\.127/ },
  { label: 'CRITICAL band at 0.70', pattern: /0\.70\s*CRITICAL/ },
  { label: 'HIGH band at 0.40', pattern: /0\.40\s*HIGH/ },
  { label: 'MEDIUM band at 0.15', pattern: /0\.15\s*MEDIUM/ },
  { label: 'A25 antecedent rainfall index', pattern: /A25/ },
  { label: 'A25 anchors 200/300/400 mm', pattern: /200\s*mm[\s\S]{0,40}300\s*mm[\s\S]{0,40}400\s*mm/ },
];

describe('ModelExplanationUseCase — MODEL_CARD invariants in the user-facing prompt', () => {
  it.each(LANGUAGES)('builds a non-empty prompt for language "%s"', (lang) => {
    const prompt = buildModelExplanationPrompt(lang);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(500);
  });

  describe.each(LANGUAGES)('language "%s"', (lang) => {
    const prompt = buildModelExplanationPrompt(lang);

    it.each(FORBIDDEN_PATTERNS)(
      'does not reintroduce legacy formulation: $label',
      ({ pattern }) => {
        expect(prompt).not.toMatch(pattern);
      }
    );

    it.each(REQUIRED_PATTERNS)('states the real model: $label', ({ pattern }) => {
      expect(prompt).toMatch(pattern);
    });
  });

  it('keeps the two language branches distinct and answers in the requested language', () => {
    const en = buildModelExplanationPrompt('en');
    const es = buildModelExplanationPrompt('es');
    expect(en).not.toBe(es);
    expect(en).toMatch(/Respond in English\./);
    expect(es).toMatch(/Responde en Español\./);
  });

  it('describes rainfall as a flux rather than a target the process is pulled back to', () => {
    expect(buildModelExplanationPrompt('en')).toMatch(/it is a flux, not a target/i);
    expect(buildModelExplanationPrompt('es')).toMatch(/es un flujo, no una meta/i);
  });

  it('states the boundedness argument that motivates the Jacobi choice', () => {
    // The justification must be "S stays inside (0,1) by construction", never
    // "mean reversion prevents negative values", which was the CIR-era argument.
    expect(buildModelExplanationPrompt('en')).toMatch(/by construction/i);
    expect(buildModelExplanationPrompt('es')).toMatch(/por construcci[oó]n/i);
  });

  it('rejects the integrated-hazard probability being described as a path count', () => {
    expect(buildModelExplanationPrompt('en')).toMatch(/NOT a count of Monte Carlo paths/i);
    expect(buildModelExplanationPrompt('es')).toMatch(/NO es un conteo de trayectorias/i);
  });
});

// ---
// 📚 WHY: Defines the contract for voice synthesis as an optional service.
//    The key design: returns null instead of throwing exceptions.
//    Without this, an ElevenLabs error (rate limit, timeout) would block the text
//    response to the user. Voice is a "nice-to-have", it must not break the main flow.
// 📁 FILE: src/domain/ports/IVoiceService.ts
// ---

export interface VoiceOptions {
  readonly voice_id?: string;
  readonly stability?: number;
  readonly similarity_boost?: number;
}

export interface IVoiceService {
  /**
   * Converts text to speech audio.
   *
   * CRITICAL CONTRACT: Returns null if the service is unavailable — NEVER throws.
   * This ensures the text response is always delivered to the user regardless
   * of voice service health. Errors are logged internally.
   */
  synthesize(text: string, options?: VoiceOptions): Promise<Buffer | null>;
}

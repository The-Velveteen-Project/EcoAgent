import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ISessionRepository } from './SessionRepository.js';
import type { UserSession, UserSettings, Message, AlertThreshold } from '../../domain/models/UserSession.js';
import { DEFAULT_USER_SETTINGS } from '../../domain/models/UserSession.js';
import type { RiskReport } from '../../application/RiskAnalysisUseCase.js';
import { logger } from '../../config/logger.js';

export class SupabaseSessionRepository implements ISessionRepository {
  private readonly supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseServiceKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    logger.info('Supabase session repository initialized');

    // Health check: count users
    this.supabase.from('users').select('id', { count: 'exact', head: true }).then(({ count, error }) => {
      if (error) logger.error({ error }, 'Failed to perform initial user count health check');
      else logger.info({ count }, 'Supabase session repository health check: total users');
    });
  }

  async isUserLinked(chatId: string): Promise<boolean> {
    logger.debug({ chatId }, 'Checking if user is linked in Supabase...');
    const userId = await this.getUserIdByChatId(chatId);
    const linked = !!userId;
    logger.info({ chatId, linked, userId }, 'User link status check completed');
    return linked;
  }

  private async getUserIdByChatId(chatId: string): Promise<string | null> {
    const cleanChatId = chatId.trim();
    
    const { data, error } = await this.supabase
      .from('users')
      .select('id')
      .eq('telegram_chat_id', cleanChatId)
      .maybeSingle();

    if (error) {
      logger.error(
        { error, chatId: cleanChatId, code: error.code, message: error.message },
        'SUPABASE_QUERY_ERROR'
      );
      return null;
    }

    if (!data) {
      logger.warn({ chatId: cleanChatId }, 'SUPABASE_NOT_FOUND: No user has this telegram_chat_id');
      
      // DIAGNOSTIC: Peek at the first 3 users to see what IDs they have
      const { data: peek } = await this.supabase.from('users').select('full_name, telegram_chat_id').limit(3);
      logger.debug({ peek }, 'SUPABASE_DIAGNOSTIC_PEEK: First 3 users in table');
      
      return null;
    }

    return data.id;
  }

  async getOrCreate(chatId: string, userId: string): Promise<UserSession> {
    const settings = await this.getSettings(chatId);
    
    // For conversation history, we could query a messages table, but for now returned empty
    // since the SaaS dashboard primarily relies on risk_reports.
    const history: Message[] = [];

    return {
      telegram_chat_id: chatId,
      user_id: userId,
      settings: settings ?? DEFAULT_USER_SETTINGS,
      conversation_history: history,
    };
  }

  async save(session: UserSession): Promise<void> {
    const userId = await this.getUserIdByChatId(session.telegram_chat_id);
    if (!userId) return; // User hasn't linked Telegram on the web platform

    await this.supabase
      .from('user_settings')
      .upsert({
        user_id: userId,
        alert_threshold: session.settings.alert_threshold,
        location_lat: session.settings.location_lat,
        location_lon: session.settings.location_lon,
        language: session.settings.language,
        voice_enabled: session.settings.voice_enabled,
        report_frequency_hours: session.settings.report_frequency_hours,
      });
  }

  async getSettings(chatId: string): Promise<UserSettings | null> {
    const userId = await this.getUserIdByChatId(chatId);
    if (!userId) return null;

    const { data, error } = await this.supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;

    return {
      alert_threshold: data.alert_threshold as AlertThreshold,
      location_lat: data.location_lat,
      location_lon: data.location_lon,
      language: data.language,
      voice_enabled: data.voice_enabled,
      report_frequency_hours: data.report_frequency_hours,
    };
  }

  async updateSettings(chatId: string, settings: Partial<UserSettings>): Promise<void> {
    const current = await this.getSettings(chatId);
    if (!current) return;

    const userId = await this.getUserIdByChatId(chatId);
    if (!userId) return;

    const merged: UserSettings = { ...current, ...settings };
    await this.supabase
      .from('user_settings')
      .update({
        alert_threshold: merged.alert_threshold,
        location_lat: merged.location_lat,
        location_lon: merged.location_lon,
        language: merged.language,
        voice_enabled: merged.voice_enabled,
        report_frequency_hours: merged.report_frequency_hours,
      })
      .eq('user_id', userId);

    logger.info({ chatId, settings }, 'Supabase user settings updated');
  }

  async getSiteState(siteId: string): Promise<number | null> {
    const { data, error } = await this.supabase
      .from('site_state')
      .select('S_estimate')
      .eq('site_id', siteId)
      .maybeSingle();

    if (error) {
      logger.error({ err: error, siteId }, 'Failed to read physical site saturation state');
      return null;
    }

    return typeof data?.S_estimate === 'number' ? data.S_estimate : null;
  }

  async saveSiteState(siteId: string, saturationEstimate: number): Promise<void> {
    const { error } = await this.supabase
      .from('site_state')
      .upsert({
        site_id: siteId,
        S_estimate: saturationEstimate,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'site_id',
      });

    if (error) {
      logger.error({ err: error, siteId }, 'Failed to persist physical site saturation state');
    }
  }

  async appendMessage(chatId: string, message: Message): Promise<void> {
    // In SaaS, we can skip text message DB logging to save Supabase storage,
    // or we can implement it if needed. The core is risk_reports.
    logger.debug({ chatId, role: message.role }, 'appendMessage ignored in SaaS platform');
  }

  async getHistory(chatId: string, limit: number = 50): Promise<readonly Message[]> {
    return [];
  }

  async saveReport(chatId: string, report: RiskReport): Promise<void> {
    const userId = await this.getUserIdByChatId(chatId);
    if (!userId) {
      logger.warn({ chatId }, 'Attempted to save report but Telegram chat ID is not linked to any SaaS account');
      return;
    }

    const { error } = await this.supabase
      .from('risk_reports')
      .insert({
        user_id: userId,
        alert_level: report.alert_level,
        risk_probability: report.simulation.risk_probability,
        mean_saturation: report.simulation.mean_saturation,
        precipitation_mm: report.weather.precipitation_mm,
        temperature_c: report.weather.temperature_c,
        humidity_pct: report.weather.humidity_pct,
      });

    if (error) {
      logger.error({ err: error, chatId }, 'Failed to save risk report to Supabase');
    } else {
      logger.info({ chatId, alert_level: report.alert_level }, 'Risk report written to SaaS dashboard');
    }
  }

}

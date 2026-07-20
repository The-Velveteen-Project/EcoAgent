// ---
// 📚 WHY: SQLite session repository for multi-user isolation.
//    Each chat_id has its own settings and history — rows are NEVER mixed.
//    The index on chat_id guarantees O(1) lookups. Without this isolation,
//    one user could see another's data, and without the index, queries would degrade
//    to O(n) as the user base grows.
// 📁 FILE: src/infrastructure/session/SessionRepository.ts
// ---

import Database from 'better-sqlite3';
import type {
  UserSession,
  UserSettings,
  Message,
  AlertThreshold,
} from '../../domain/models/UserSession.js';
import { DEFAULT_USER_SETTINGS } from '../../domain/models/UserSession.js';
import { logger } from '../../config/logger.js';

import type { RiskReport } from '../../application/RiskAnalysisUseCase.js';

// ── Repository Interface ─────────────────────────────────────
export interface ISessionRepository {
  getOrCreate(chatId: string, userId: string): Promise<UserSession>;
  save(session: UserSession): Promise<void>;
  getSettings(chatId: string): Promise<UserSettings | null>;
  updateSettings(chatId: string, settings: Partial<UserSettings>): Promise<void>;
  getSiteState(siteId: string): Promise<number | null>;
  saveSiteState(siteId: string, saturationEstimate: number): Promise<void>;
  appendMessage(chatId: string, message: Message): Promise<void>;
  getHistory(chatId: string, limit?: number): Promise<readonly Message[]>;
  saveReport(chatId: string, report: RiskReport): Promise<void>;
  isUserLinked(chatId: string): Promise<boolean>;
}

// ── SQLite Implementation ────────────────────────────────────
export class SQLiteSessionRepository implements ISessionRepository {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    logger.info({ dbPath }, 'SQLite session repository initialized');
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_settings (
        chat_id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        alert_threshold TEXT NOT NULL DEFAULT 'HIGH',
        location_lat REAL NOT NULL DEFAULT 5.0703,
        location_lon REAL NOT NULL DEFAULT -75.5138,
        language TEXT NOT NULL DEFAULT 'es',
        voice_enabled INTEGER NOT NULL DEFAULT 1,
        report_frequency_hours INTEGER NOT NULL DEFAULT 6,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_settings_chat_id ON user_settings(chat_id);

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (chat_id) REFERENCES user_settings(chat_id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);

      CREATE TABLE IF NOT EXISTS site_state (
        site_id TEXT PRIMARY KEY NOT NULL,
        S_estimate REAL NOT NULL CHECK (S_estimate >= 0 AND S_estimate <= 1),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  async getOrCreate(chatId: string, userId: string): Promise<UserSession> {
    const existing = this.db
      .prepare('SELECT * FROM user_settings WHERE chat_id = ?')
      .get(chatId) as Record<string, unknown> | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO user_settings (chat_id, user_id, alert_threshold, location_lat, location_lon, language, voice_enabled, report_frequency_hours)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          chatId,
          userId,
          DEFAULT_USER_SETTINGS.alert_threshold,
          DEFAULT_USER_SETTINGS.location_lat,
          DEFAULT_USER_SETTINGS.location_lon,
          DEFAULT_USER_SETTINGS.language,
          DEFAULT_USER_SETTINGS.voice_enabled ? 1 : 0,
          DEFAULT_USER_SETTINGS.report_frequency_hours
        );

      logger.info({ chatId, userId }, 'New user session created');
    }

    const settings = await this.getSettings(chatId);
    const history = await this.getHistory(chatId);

    return {
      telegram_chat_id: chatId,
      user_id: userId,
      settings: settings ?? DEFAULT_USER_SETTINGS,
      conversation_history: history,
    };
  }

  async save(session: UserSession): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO user_settings
         (chat_id, user_id, alert_threshold, location_lat, location_lon, language, voice_enabled, report_frequency_hours, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(
        session.telegram_chat_id,
        session.user_id,
        session.settings.alert_threshold,
        session.settings.location_lat,
        session.settings.location_lon,
        session.settings.language,
        session.settings.voice_enabled ? 1 : 0,
        session.settings.report_frequency_hours
      );
  }

  async getSettings(chatId: string): Promise<UserSettings | null> {
    const row = this.db
      .prepare('SELECT * FROM user_settings WHERE chat_id = ?')
      .get(chatId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      alert_threshold: row['alert_threshold'] as AlertThreshold,
      location_lat: row['location_lat'] as number,
      location_lon: row['location_lon'] as number,
      language: row['language'] as string,
      voice_enabled: (row['voice_enabled'] as number) === 1,
      report_frequency_hours: row['report_frequency_hours'] as number,
    };
  }

  async updateSettings(chatId: string, settings: Partial<UserSettings>): Promise<void> {
    const current = await this.getSettings(chatId);
    if (!current) {
      logger.warn({ chatId }, 'Attempted to update settings for non-existent user');
      return;
    }

    const merged: UserSettings = { ...current, ...settings };

    this.db
      .prepare(
        `UPDATE user_settings
         SET alert_threshold = ?, location_lat = ?, location_lon = ?,
             language = ?, voice_enabled = ?, report_frequency_hours = ?,
             updated_at = datetime('now')
         WHERE chat_id = ?`
      )
      .run(
        merged.alert_threshold,
        merged.location_lat,
        merged.location_lon,
        merged.language,
        merged.voice_enabled ? 1 : 0,
        merged.report_frequency_hours,
        chatId
      );

    logger.info({ chatId, settings }, 'User settings updated');
  }

  async getSiteState(siteId: string): Promise<number | null> {
    const row = this.db
      .prepare('SELECT S_estimate FROM site_state WHERE site_id = ?')
      .get(siteId) as { S_estimate: number } | undefined;

    return row?.S_estimate ?? null;
  }

  async saveSiteState(siteId: string, saturationEstimate: number): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO site_state (site_id, S_estimate, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(site_id) DO UPDATE SET
           S_estimate = excluded.S_estimate,
           updated_at = datetime('now')`
      )
      .run(siteId, saturationEstimate);
  }

  async appendMessage(chatId: string, message: Message): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO messages (chat_id, role, content, timestamp) VALUES (?, ?, ?, ?)'
      )
      .run(chatId, message.role, message.content, message.timestamp.toISOString());
  }

  async getHistory(chatId: string, limit: number = 50): Promise<readonly Message[]> {
    const rows = this.db
      .prepare(
        'SELECT role, content, timestamp FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(chatId, limit) as Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;

    // Reverse to get chronological order (oldest first)
    return rows.reverse().map((row) => ({
      role: row.role,
      content: row.content,
      timestamp: new Date(row.timestamp),
    }));
  }

  async saveReport(chatId: string, report: RiskReport): Promise<void> {
    // Only implemented in SupabaseSessionRepository
    logger.debug({ chatId, alert_level: report.alert_level }, 'saveReport ignored in SQLite');
  }

  async isUserLinked(chatId: string): Promise<boolean> {
    const row = this.db
      .prepare('SELECT 1 FROM user_settings WHERE chat_id = ?')
      .get(chatId);
    return !!row;
  }
}

// ---
// 📚 WHY: Authentication middleware that replaces the static list of IDs.
//    Every message passes through here first. It looks up the user's session in the repository;
//    if it doesn't exist, it asks them to register. Without this, anyone could use
//    the bot without restriction, or worse, the bot would crash when it couldn't find a session.
// 📁 FILE: src/interfaces/telegram/middleware/authMiddleware.ts
// ---

import type { Context, NextFunction } from 'grammy';
import type { ISessionRepository } from '../../../infrastructure/session/SessionRepository.js';
import type { UserSession } from '../../../domain/models/UserSession.js';
import { logger } from '../../../config/logger.js';

/**
 * Extended Grammy context with user session attached by middleware.
 */
export interface EcoAgentContext extends Context {
  session?: UserSession;
}

/**
 * Creates an auth middleware that loads (or creates) a user session
 * for every incoming message.
 *
 * Currently uses TELEGRAM_ALLOWED_USER_IDS as a transitional guard.
 * Once Supabase auth is fully integrated, this will check against
 * the users table instead.
 */
export function createAuthMiddleware(
  sessionRepo: ISessionRepository,
  allowedUserIds: readonly number[]
): (ctx: EcoAgentContext, next: NextFunction) => Promise<void> {
  return async (ctx: EcoAgentContext, next: NextFunction): Promise<void> => {
    if (!ctx.from) return;

    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;
    const userId = ctx.from.id.toString();

    // 1. Always allow /start, /ayuda, and /modelo (onboarding and educational commands)
    const command = ctx.message?.text?.split(' ')[0];
    const isPublicCommand = ['/start', '/ayuda', '/modelo'].includes(command ?? '');

    if (isPublicCommand) {
      try {
        const session = await sessionRepo.getOrCreate(chatId, userId);
        ctx.session = session;
        await next();
      } catch (err) {
        logger.error({ err, chatId }, 'Failed to load public session');
      }
      return;
    }

    // 2. Hybrid Authorization Check (Whitelist OR Linked Client)
    const isWhitelisted = allowedUserIds.length > 0 && allowedUserIds.includes(ctx.from.id);
    const isLinked = await sessionRepo.isUserLinked(chatId);

    if (!isWhitelisted && !isLinked) {
      logger.warn(
        { userId, username: ctx.from.username },
        'Unauthorized access attempt blocked'
      );
      
      const name = ctx.from.first_name || 'user';
      await ctx.reply(
        `Hello ${name}. ALLO is a private monitoring and decision-support platform.\n\n` +
        `To unlock all features:\n` +
        `1. Sign up on the web platform.\n` +
        `2. Link your Telegram using your ID: \`${userId}\`.\n\n` +
        `You can use /modelo to learn how we work.`
      );
      return;
    }

    try {
      // Load or create user session
      const session = await sessionRepo.getOrCreate(chatId, userId);
      ctx.session = session;
      await next();
    } catch (err: unknown) {
      logger.error({ err, chatId }, 'Failed to load user session');
      await ctx.reply('Internal error loading your session. Try again.');
    }
  };
}

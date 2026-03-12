/**
 * @fileoverview Quota recovery manager — detects Claude API rate limits and auto-restarts sessions.
 *
 * Monitors session output for rate limit / overloaded indicators.
 * When detected, marks session as quota-limited and schedules periodic retry.
 * On recovery, automatically triggers respawn to resume the session.
 *
 * Key exports:
 * - `QuotaRecoveryManager` class — singleton per WebServer instance
 * - `QuotaRecoveryManager.isQuotaLimitError(text)` — static checker for output scanning
 *
 * @dependencies session (Session.setQuotaLimited), respawn-controller (signalIdlePrompt)
 * @consumedby web/server (setupSessionListeners, route context)
 *
 * @module quota-recovery-manager
 */

import { CleanupManager } from './utils/index.js';
import type { Session } from './session.js';
import type { RespawnController } from './respawn-controller.js';

/** Patterns in session output that indicate quota exhaustion */
const QUOTA_ERROR_PATTERNS: RegExp[] = [
  /overloaded_error/i,
  /rate[_\s]limit/i,
  /too many requests/i,
  /quota exceeded/i,
  /529/, // Claude's "overloaded" HTTP status
  /您的请求被限流/i,
];

/** How often to check if quota has recovered (ms) */
const QUOTA_RETRY_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/** Max retry duration before giving up (ms) */
const QUOTA_MAX_RETRY_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Manages quota-limit detection and automatic session recovery.
 *
 * Flow:
 * 1. Caller feeds session output into `checkOutput(sessionId, text)`
 * 2. On match, marks session as quota-limited and schedules retry timer
 * 3. Each retry: if session still limited and has active respawn controller,
 *    calls `signalIdlePrompt()` to trigger a respawn cycle
 * 4. Stops retrying after QUOTA_MAX_RETRY_DURATION_MS
 */
export class QuotaRecoveryManager {
  private readonly cleanup = new CleanupManager();
  /** Active retry timers keyed by sessionId */
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** sessions map from the server (read-only reference) */
  private readonly sessions: ReadonlyMap<string, Session>;
  /** respawnControllers map from the server (read-only reference) */
  private readonly respawnControllers: ReadonlyMap<string, RespawnController>;

  constructor(sessions: ReadonlyMap<string, Session>, respawnControllers: ReadonlyMap<string, RespawnController>) {
    this.sessions = sessions;
    this.respawnControllers = respawnControllers;
  }

  /**
   * Check if output text contains quota-limit indicators.
   * Safe to call on every chunk — uses early-exit on first match.
   */
  static isQuotaLimitError(text: string): boolean {
    return QUOTA_ERROR_PATTERNS.some((pattern) => pattern.test(text));
  }

  /**
   * Feed a chunk of session output for quota-limit detection.
   * Call this from setupSessionListeners on the 'output' event.
   */
  checkOutput(sessionId: string, text: string): void {
    if (this.cleanup.isStopped) return;
    if (!QuotaRecoveryManager.isQuotaLimitError(text)) return;

    this.markQuotaLimited(sessionId);
  }

  /**
   * Mark session as quota-limited and schedule retry.
   * Idempotent — calling again while already limited is a no-op.
   */
  markQuotaLimited(sessionId: string): void {
    if (this.cleanup.isStopped) return;

    // Avoid duplicate timers
    if (this.retryTimers.has(sessionId)) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    const limitedAt = Date.now();
    session.setQuotaLimited(true, limitedAt, limitedAt + QUOTA_RETRY_INTERVAL_MS);

    console.log(`[QuotaRecovery] Session ${sessionId} quota-limited at ${new Date(limitedAt).toISOString()}`);

    this.scheduleRetry(sessionId, limitedAt);
  }

  /**
   * Schedule the next retry for quota recovery.
   */
  private scheduleRetry(sessionId: string, limitedAt: number): void {
    if (this.cleanup.isStopped) return;

    if (Date.now() - limitedAt > QUOTA_MAX_RETRY_DURATION_MS) {
      console.log(`[QuotaRecovery] Session ${sessionId} exceeded max retry duration, giving up`);
      this.clearRetry(sessionId);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.setQuotaLimited(false, undefined, undefined);
      }
      return;
    }

    const timer = setTimeout(() => {
      this.retryTimers.delete(sessionId);
      this.attemptRecovery(sessionId, limitedAt);
    }, QUOTA_RETRY_INTERVAL_MS);

    this.retryTimers.set(sessionId, timer);
  }

  /**
   * Attempt to recover from quota limit by triggering a respawn cycle.
   * Uses signalIdlePrompt() which is the standard "Claude is idle" trigger.
   */
  private attemptRecovery(sessionId: string, limitedAt: number): void {
    if (this.cleanup.isStopped) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Already recovered manually
    if (!session.quotaLimited) return;

    // Check max retry duration
    if (Date.now() - limitedAt > QUOTA_MAX_RETRY_DURATION_MS) {
      session.setQuotaLimited(false, undefined, undefined);
      console.log(`[QuotaRecovery] Session ${sessionId} max retry duration exceeded, clearing`);
      return;
    }

    // Update next retry time
    session.setQuotaLimited(true, session.quotaLimitedAt, Date.now() + QUOTA_RETRY_INTERVAL_MS);

    const controller = this.respawnControllers.get(sessionId);
    if (controller) {
      // Signal idle to trigger a respawn cycle
      controller.signalIdlePrompt();
      console.log(`[QuotaRecovery] Session ${sessionId} triggered respawn cycle via signalIdlePrompt`);

      // Clear quota-limited flag — respawn will restart the session
      session.setQuotaLimited(false, undefined, undefined);
    } else {
      // No respawn controller — schedule next retry and wait
      console.log(`[QuotaRecovery] Session ${sessionId} has no respawn controller, will retry later`);
      this.scheduleRetry(sessionId, limitedAt);
    }
  }

  /**
   * Manually clear quota-limited status for a session.
   */
  clearQuotaLimited(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.setQuotaLimited(false, undefined, undefined);
    }
    this.clearRetry(sessionId);
    console.log(`[QuotaRecovery] Session ${sessionId} quota-limited status cleared manually`);
  }

  /**
   * Get quota status for a session (for API responses).
   */
  getQuotaStatus(sessionId: string): { quotaLimited: boolean; quotaLimitedAt?: number; quotaRetryAt?: number } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { quotaLimited: false };
    }
    return {
      quotaLimited: session.quotaLimited,
      quotaLimitedAt: session.quotaLimitedAt,
      quotaRetryAt: session.quotaRetryAt,
    };
  }

  private clearRetry(sessionId: string): void {
    const timer = this.retryTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(sessionId);
    }
  }

  stop(): void {
    this.cleanup.dispose();
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
  }
}

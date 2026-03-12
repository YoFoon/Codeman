/**
 * @fileoverview Tests for QuotaRecoveryManager
 *
 * Verifies quota limit detection, session state marking, retry scheduling,
 * and recovery via signalIdlePrompt().
 *
 * Port: N/A (unit tests, no server)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuotaRecoveryManager } from '../src/quota-recovery-manager.js';

// ─── Minimal mock types ──────────────────────────────────────────────────────

interface MockSession {
  id: string;
  quotaLimited: boolean;
  quotaLimitedAt: number | undefined;
  quotaRetryAt: number | undefined;
  setQuotaLimited: ReturnType<typeof vi.fn>;
}

interface MockController {
  signalIdlePrompt: ReturnType<typeof vi.fn>;
}

function makeMockSession(id: string = 'session-1'): MockSession {
  const s: MockSession = {
    id,
    quotaLimited: false,
    quotaLimitedAt: undefined,
    quotaRetryAt: undefined,
    setQuotaLimited: vi.fn((limited: boolean, limitedAt?: number, retryAt?: number) => {
      s.quotaLimited = limited;
      s.quotaLimitedAt = limitedAt;
      s.quotaRetryAt = retryAt;
    }),
  };
  return s;
}

function makeMockController(): MockController {
  return { signalIdlePrompt: vi.fn() };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('QuotaRecoveryManager', () => {
  let sessions: Map<string, MockSession>;
  let controllers: Map<string, MockController>;
  let manager: QuotaRecoveryManager;

  beforeEach(() => {
    vi.useFakeTimers();
    sessions = new Map();
    controllers = new Map();
    manager = new QuotaRecoveryManager(
      sessions as unknown as ReadonlyMap<string, import('../src/session.js').Session>,
      controllers as unknown as ReadonlyMap<string, import('../src/respawn-controller.js').RespawnController>
    );
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  // ─── isQuotaLimitError ───────────────────────────────────────────────────

  describe('isQuotaLimitError()', () => {
    it('detects overloaded_error pattern', () => {
      expect(QuotaRecoveryManager.isQuotaLimitError('{"type":"error","error":{"type":"overloaded_error"}}')).toBe(true);
    });

    it('detects rate_limit pattern', () => {
      expect(QuotaRecoveryManager.isQuotaLimitError('API rate_limit exceeded')).toBe(true);
    });

    it('detects rate limit with space', () => {
      expect(QuotaRecoveryManager.isQuotaLimitError('You hit the rate limit')).toBe(true);
    });

    it('detects too many requests', () => {
      expect(QuotaRecoveryManager.isQuotaLimitError('Too many requests')).toBe(true);
    });

    it('detects quota exceeded', () => {
      expect(QuotaRecoveryManager.isQuotaLimitError('quota exceeded for this period')).toBe(true);
    });

    it('detects HTTP 529 status code', () => {
      expect(QuotaRecoveryManager.isQuotaLimitError('Error: 529 Service Overloaded')).toBe(true);
    });

    it('detects Chinese rate limit message', () => {
      expect(QuotaRecoveryManager.isQuotaLimitError('您的请求被限流，请稍后重试')).toBe(true);
    });

    it('returns false for normal output', () => {
      expect(QuotaRecoveryManager.isQuotaLimitError('All good! Task completed.')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(QuotaRecoveryManager.isQuotaLimitError('')).toBe(false);
    });

    it('case-insensitive matching', () => {
      expect(QuotaRecoveryManager.isQuotaLimitError('OVERLOADED_ERROR')).toBe(true);
      expect(QuotaRecoveryManager.isQuotaLimitError('Rate Limit')).toBe(true);
    });
  });

  // ─── markQuotaLimited ───────────────────────────────────────────────────

  describe('markQuotaLimited()', () => {
    it('marks session as quota-limited', () => {
      const session = makeMockSession('s1');
      sessions.set('s1', session);

      manager.markQuotaLimited('s1');

      expect(session.setQuotaLimited).toHaveBeenCalledOnce();
      expect(session.quotaLimited).toBe(true);
      expect(session.quotaLimitedAt).toBeDefined();
    });

    it('is idempotent — does not create duplicate timers', () => {
      const session = makeMockSession('s1');
      sessions.set('s1', session);

      manager.markQuotaLimited('s1');
      manager.markQuotaLimited('s1'); // second call

      // setQuotaLimited only called once (second call is a no-op)
      expect(session.setQuotaLimited).toHaveBeenCalledOnce();
    });

    it('does nothing if session not found', () => {
      // No session in map — should not throw
      expect(() => manager.markQuotaLimited('nonexistent')).not.toThrow();
    });
  });

  // ─── checkOutput ────────────────────────────────────────────────────────

  describe('checkOutput()', () => {
    it('marks session limited when output contains quota error', () => {
      const session = makeMockSession('s1');
      sessions.set('s1', session);

      manager.checkOutput('s1', 'overloaded_error detected');

      expect(session.quotaLimited).toBe(true);
    });

    it('does nothing for normal output', () => {
      const session = makeMockSession('s1');
      sessions.set('s1', session);

      manager.checkOutput('s1', 'Everything is fine');

      expect(session.quotaLimited).toBe(false);
    });
  });

  // ─── clearQuotaLimited ──────────────────────────────────────────────────

  describe('clearQuotaLimited()', () => {
    it('clears quota-limited status', () => {
      const session = makeMockSession('s1');
      sessions.set('s1', session);

      manager.markQuotaLimited('s1');
      expect(session.quotaLimited).toBe(true);

      manager.clearQuotaLimited('s1');
      expect(session.quotaLimited).toBe(false);
    });

    it('cancels the retry timer', () => {
      const session = makeMockSession('s1');
      sessions.set('s1', session);

      manager.markQuotaLimited('s1');

      // Clear before retry fires
      manager.clearQuotaLimited('s1');

      // Advance time past retry interval — controller should NOT be called
      const controller = makeMockController();
      controllers.set('s1', controller);
      vi.advanceTimersByTime(70 * 1000);

      expect(controller.signalIdlePrompt).not.toHaveBeenCalled();
    });
  });

  // ─── getQuotaStatus ─────────────────────────────────────────────────────

  describe('getQuotaStatus()', () => {
    it('returns not limited for unknown session', () => {
      const status = manager.getQuotaStatus('unknown');
      expect(status).toEqual({ quotaLimited: false });
    });

    it('returns current quota status for a session', () => {
      const session = makeMockSession('s1');
      sessions.set('s1', session);

      manager.markQuotaLimited('s1');

      const status = manager.getQuotaStatus('s1');
      expect(status.quotaLimited).toBe(true);
      expect(status.quotaLimitedAt).toBeDefined();
      expect(status.quotaRetryAt).toBeDefined();
    });
  });

  // ─── retry / recovery ───────────────────────────────────────────────────

  describe('retry and recovery', () => {
    it('triggers signalIdlePrompt after QUOTA_RETRY_INTERVAL_MS when controller present', () => {
      const session = makeMockSession('s1');
      sessions.set('s1', session);
      const controller = makeMockController();
      controllers.set('s1', controller);

      manager.markQuotaLimited('s1');

      // Advance past 1-minute retry interval
      vi.advanceTimersByTime(61 * 1000);

      expect(controller.signalIdlePrompt).toHaveBeenCalledOnce();
      // Quota cleared after successful trigger
      expect(session.quotaLimited).toBe(false);
    });

    it('schedules next retry if no controller available', () => {
      const session = makeMockSession('s1');
      sessions.set('s1', session);
      // No controller

      manager.markQuotaLimited('s1');

      // First retry fires — no controller, reschedules
      vi.advanceTimersByTime(61 * 1000);
      expect(session.quotaLimited).toBe(true); // still limited

      // Add controller, second retry fires
      const controller = makeMockController();
      controllers.set('s1', controller);
      vi.advanceTimersByTime(61 * 1000);

      expect(controller.signalIdlePrompt).toHaveBeenCalledOnce();
    });

    it('does not retry after max duration exceeded', () => {
      const session = makeMockSession('s1');
      sessions.set('s1', session);
      const controller = makeMockController();
      controllers.set('s1', controller);

      manager.markQuotaLimited('s1');

      // Simulate the recovery manager being stopped before retry
      manager.stop();

      vi.advanceTimersByTime(70 * 1000);
      expect(controller.signalIdlePrompt).not.toHaveBeenCalled();
    });
  });
});

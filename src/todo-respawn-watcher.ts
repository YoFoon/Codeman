/**
 * @fileoverview Todo-based respawn watcher.
 *
 * Periodically checks if any active session's project has pending todos.
 * If a session is idle with an active respawn controller and its project has
 * pending todos, triggers a respawn cycle via signalIdlePrompt().
 *
 * Key exports:
 * - `TodoRespawnWatcher` class — start/stop lifecycle, checkAll() polling
 *
 * @dependencies project-todos (hasPendingTodos), respawn-controller (signalIdlePrompt)
 * @consumedby web/server
 *
 * @module todo-respawn-watcher
 */

import { CleanupManager } from './utils/index.js';
import { hasPendingTodos } from './project-todos.js';
import type { Session } from './session.js';
import type { RespawnController } from './respawn-controller.js';

const CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * Watches all sessions every 30s. For each idle session with pending todos
 * and an active respawn controller, triggers a respawn cycle.
 */
export class TodoRespawnWatcher {
  private readonly cleanup = new CleanupManager();
  private readonly sessions: ReadonlyMap<string, Session>;
  private readonly respawnControllers: ReadonlyMap<string, RespawnController>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(sessions: ReadonlyMap<string, Session>, respawnControllers: ReadonlyMap<string, RespawnController>) {
    this.sessions = sessions;
    this.respawnControllers = respawnControllers;
  }

  start(): void {
    if (this.cleanup.isStopped) return;
    this.timer = setInterval(() => this.checkAll(), CHECK_INTERVAL_MS);
  }

  private checkAll(): void {
    if (this.cleanup.isStopped) return;

    for (const session of this.sessions.values()) {
      const state = session.toState();

      // Only trigger for idle sessions that have respawn enabled
      if (state.status !== 'idle') continue;
      if (!state.respawnEnabled) continue;
      if (!state.workingDir) continue;
      if (!hasPendingTodos(state.workingDir)) continue;

      const controller = this.respawnControllers.get(session.id);
      if (!controller) continue;

      controller.signalIdlePrompt();
      console.log(
        `[TodoRespawnWatcher] Triggered respawn for session ${session.id} (pending todos in ${state.workingDir})`
      );
    }
  }

  stop(): void {
    this.cleanup.dispose();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

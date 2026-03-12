/**
 * @fileoverview Tests for project-todos module
 *
 * Verifies CRUD operations and hasPendingTodos logic.
 * Uses a temp file to avoid polluting the real project-todos.json.
 *
 * Port: N/A (unit tests, no server)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const TODOS_FILE = join(homedir(), '.codeman', 'project-todos.json');

function cleanupFile(): void {
  if (existsSync(TODOS_FILE)) {
    writeFileSync(TODOS_FILE, JSON.stringify({ version: 1, todos: [] }, null, 2), 'utf-8');
  }
}

describe('project-todos', () => {
  // Reset the store before each test
  beforeEach(() => {
    cleanupFile();
    // Clear module cache so each test starts with a fresh loadStore()
    vi.resetModules();
  });

  afterEach(() => {
    cleanupFile();
  });

  // ─── createTodo ────────────────────────────────────────────────────────

  describe('createTodo()', () => {
    it('creates a todo with required fields', async () => {
      const { createTodo } = await import('../src/project-todos.js');
      const todo = createTodo('/test/project', 'todo', 'Fix the login bug');

      expect(todo.id).toMatch(/^[0-9a-f]{16}$/);
      expect(todo.projectDir).toBe('/test/project');
      expect(todo.type).toBe('todo');
      expect(todo.content).toBe('Fix the login bug');
      expect(todo.status).toBe('pending');
      expect(todo.createdAt).toBeGreaterThan(0);
      expect(todo.updatedAt).toBeGreaterThan(0);
    });

    it('creates a brainstorm note', async () => {
      const { createTodo } = await import('../src/project-todos.js');
      const todo = createTodo('/test/project', 'brainstorm', 'What if we add OAuth?');

      expect(todo.type).toBe('brainstorm');
      expect(todo.status).toBe('pending');
    });

    it('accepts optional tags and priority', async () => {
      const { createTodo } = await import('../src/project-todos.js');
      const todo = createTodo('/test/project', 'todo', 'Perf work', {
        tags: ['performance', 'backend'],
        priority: 'high',
      });

      expect(todo.tags).toEqual(['performance', 'backend']);
      expect(todo.priority).toBe('high');
    });

    it('persists across multiple calls', async () => {
      const { createTodo, getTodosForProject } = await import('../src/project-todos.js');
      createTodo('/test/project', 'todo', 'First');
      createTodo('/test/project', 'todo', 'Second');

      const todos = getTodosForProject('/test/project');
      expect(todos).toHaveLength(2);
    });
  });

  // ─── getTodosForProject ─────────────────────────────────────────────────

  describe('getTodosForProject()', () => {
    it('returns only todos for the specified project', async () => {
      const { createTodo, getTodosForProject } = await import('../src/project-todos.js');
      createTodo('/project/a', 'todo', 'Task A');
      createTodo('/project/b', 'todo', 'Task B');

      const todosA = getTodosForProject('/project/a');
      expect(todosA).toHaveLength(1);
      expect(todosA[0].content).toBe('Task A');
    });

    it('returns empty array for unknown project', async () => {
      const { getTodosForProject } = await import('../src/project-todos.js');
      expect(getTodosForProject('/nonexistent')).toEqual([]);
    });
  });

  // ─── updateTodo ─────────────────────────────────────────────────────────

  describe('updateTodo()', () => {
    it('updates status', async () => {
      const { createTodo, updateTodo } = await import('../src/project-todos.js');
      const todo = createTodo('/test/project', 'todo', 'Do something');

      const updated = updateTodo(todo.id, { status: 'done' });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('done');
    });

    it('updates content', async () => {
      const { createTodo, updateTodo } = await import('../src/project-todos.js');
      const todo = createTodo('/test/project', 'todo', 'Original');

      const updated = updateTodo(todo.id, { content: 'Updated content' });
      expect(updated!.content).toBe('Updated content');
    });

    it('returns null for non-existent id', async () => {
      const { updateTodo } = await import('../src/project-todos.js');
      expect(updateTodo('nonexistent-id', { status: 'done' })).toBeNull();
    });

    it('updates updatedAt timestamp', async () => {
      const { createTodo, updateTodo } = await import('../src/project-todos.js');
      const todo = createTodo('/test/project', 'todo', 'Timed');
      const before = todo.updatedAt;

      // Ensure some time passes
      await new Promise((r) => setTimeout(r, 5));

      const updated = updateTodo(todo.id, { status: 'in_progress' });
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(before);
    });
  });

  // ─── deleteTodo ─────────────────────────────────────────────────────────

  describe('deleteTodo()', () => {
    it('deletes an existing todo', async () => {
      const { createTodo, deleteTodo, getTodosForProject } = await import('../src/project-todos.js');
      const todo = createTodo('/test/project', 'todo', 'To delete');

      const result = deleteTodo(todo.id);
      expect(result).toBe(true);
      expect(getTodosForProject('/test/project')).toHaveLength(0);
    });

    it('returns false for non-existent id', async () => {
      const { deleteTodo } = await import('../src/project-todos.js');
      expect(deleteTodo('does-not-exist')).toBe(false);
    });

    it('does not affect other todos', async () => {
      const { createTodo, deleteTodo, getTodosForProject } = await import('../src/project-todos.js');
      const a = createTodo('/test/project', 'todo', 'Keep me');
      const b = createTodo('/test/project', 'todo', 'Delete me');

      deleteTodo(b.id);

      const remaining = getTodosForProject('/test/project');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(a.id);
    });
  });

  // ─── hasPendingTodos ────────────────────────────────────────────────────

  describe('hasPendingTodos()', () => {
    it('returns true when pending todos exist', async () => {
      const { createTodo, hasPendingTodos } = await import('../src/project-todos.js');
      createTodo('/test/project', 'todo', 'Pending task');

      expect(hasPendingTodos('/test/project')).toBe(true);
    });

    it('returns true when in_progress todos exist', async () => {
      const { createTodo, updateTodo, hasPendingTodos } = await import('../src/project-todos.js');
      const todo = createTodo('/test/project', 'todo', 'In progress');
      updateTodo(todo.id, { status: 'in_progress' });

      expect(hasPendingTodos('/test/project')).toBe(true);
    });

    it('returns false when all todos are done', async () => {
      const { createTodo, updateTodo, hasPendingTodos } = await import('../src/project-todos.js');
      const todo = createTodo('/test/project', 'todo', 'Done item');
      updateTodo(todo.id, { status: 'done' });

      expect(hasPendingTodos('/test/project')).toBe(false);
    });

    it('returns false when all todos are cancelled', async () => {
      const { createTodo, updateTodo, hasPendingTodos } = await import('../src/project-todos.js');
      const todo = createTodo('/test/project', 'todo', 'Cancelled');
      updateTodo(todo.id, { status: 'cancelled' });

      expect(hasPendingTodos('/test/project')).toBe(false);
    });

    it('returns false for project with no todos', async () => {
      const { hasPendingTodos } = await import('../src/project-todos.js');
      expect(hasPendingTodos('/no/todos/here')).toBe(false);
    });
  });

  // ─── getPendingTodosForProject ──────────────────────────────────────────

  describe('getPendingTodosForProject()', () => {
    it('returns only pending and in_progress todos', async () => {
      const { createTodo, updateTodo, getPendingTodosForProject } = await import('../src/project-todos.js');
      const a = createTodo('/test/project', 'todo', 'Pending');
      const b = createTodo('/test/project', 'todo', 'Done');
      updateTodo(b.id, { status: 'done' });
      createTodo('/test/project', 'todo', 'In progress');

      const pending = getPendingTodosForProject('/test/project');
      expect(pending).toHaveLength(2);
      expect(pending.map((t) => t.id)).toContain(a.id);
    });
  });

  // ─── edge cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles missing todos file gracefully', async () => {
      // Delete file entirely
      if (existsSync(TODOS_FILE)) {
        unlinkSync(TODOS_FILE);
      }

      const { getTodosForProject } = await import('../src/project-todos.js');
      expect(getTodosForProject('/any/project')).toEqual([]);
    });

    it('handles corrupted json file gracefully', async () => {
      writeFileSync(TODOS_FILE, 'NOT VALID JSON', 'utf-8');

      const { getTodosForProject } = await import('../src/project-todos.js');
      expect(getTodosForProject('/any/project')).toEqual([]);
    });
  });
});

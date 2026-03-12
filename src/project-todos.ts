/**
 * @fileoverview Project-level todo and brainstorm list manager.
 *
 * Persists per-project todos to ~/.codeman/project-todos.json.
 * Provides CRUD operations for todos and brainstorm notes tied to a working directory.
 *
 * Key exports:
 * - `getTodosForProject(projectDir)` — all todos for a project
 * - `getPendingTodosForProject(projectDir)` — pending/in_progress only
 * - `createTodo(...)` — create a new todo
 * - `updateTodo(id, updates)` — update status/content/tags/priority
 * - `deleteTodo(id)` — remove a todo
 * - `hasPendingTodos(projectDir)` — quick check for pending work
 *
 * @module project-todos
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';
export type TodoType = 'todo' | 'brainstorm';
export type TodoPriority = 'low' | 'medium' | 'high';

export interface ProjectTodo {
  id: string;
  projectDir: string;
  type: TodoType;
  content: string;
  status: TodoStatus;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  priority?: TodoPriority;
}

interface ProjectTodosStore {
  version: 1;
  todos: ProjectTodo[];
}

const TODOS_FILE = join(homedir(), '.codeman', 'project-todos.json');

function loadStore(): ProjectTodosStore {
  if (!existsSync(TODOS_FILE)) {
    return { version: 1, todos: [] };
  }
  try {
    const raw = readFileSync(TODOS_FILE, 'utf-8');
    return JSON.parse(raw) as ProjectTodosStore;
  } catch {
    return { version: 1, todos: [] };
  }
}

function saveStore(store: ProjectTodosStore): void {
  writeFileSync(TODOS_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export function getTodosForProject(projectDir: string): ProjectTodo[] {
  const store = loadStore();
  return store.todos.filter((t) => t.projectDir === projectDir);
}

export function getPendingTodosForProject(projectDir: string): ProjectTodo[] {
  return getTodosForProject(projectDir).filter((t) => t.status === 'pending' || t.status === 'in_progress');
}

export function createTodo(
  projectDir: string,
  type: TodoType,
  content: string,
  options?: { tags?: string[]; priority?: TodoPriority }
): ProjectTodo {
  const store = loadStore();
  const now = Date.now();
  const todo: ProjectTodo = {
    id: randomBytes(8).toString('hex'),
    projectDir,
    type,
    content,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...options,
  };
  store.todos.push(todo);
  saveStore(store);
  return todo;
}

export function updateTodo(
  id: string,
  updates: Partial<Pick<ProjectTodo, 'content' | 'status' | 'tags' | 'priority'>>
): ProjectTodo | null {
  const store = loadStore();
  const idx = store.todos.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const existing = store.todos[idx];
  store.todos[idx] = { ...existing, ...updates, updatedAt: Date.now() };
  saveStore(store);
  return store.todos[idx];
}

export function deleteTodo(id: string): boolean {
  const store = loadStore();
  const before = store.todos.length;
  store.todos = store.todos.filter((t) => t.id !== id);
  if (store.todos.length === before) return false;
  saveStore(store);
  return true;
}

export function hasPendingTodos(projectDir: string): boolean {
  return getPendingTodosForProject(projectDir).length > 0;
}

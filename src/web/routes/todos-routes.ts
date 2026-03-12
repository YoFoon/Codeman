/**
 * @fileoverview Project todo and brainstorm list routes.
 *
 * Provides CRUD endpoints for per-project todo/brainstorm items.
 * Todos are persisted to ~/.codeman/project-todos.json.
 *
 * @routes
 *   GET    /api/todos?projectDir=...           — list todos for project
 *   POST   /api/todos                          — create todo
 *   PATCH  /api/todos/:id                      — update todo
 *   DELETE /api/todos/:id                      — delete todo
 *   GET    /api/todos/has-pending?projectDir=. — check if has pending todos
 *
 * @module web/routes/todos-routes
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getTodosForProject, createTodo, updateTodo, deleteTodo, hasPendingTodos } from '../../project-todos.js';

const CreateTodoSchema = z.object({
  projectDir: z.string().min(1),
  type: z.enum(['todo', 'brainstorm']),
  content: z.string().min(1).max(2000),
  tags: z.array(z.string()).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});

const UpdateTodoSchema = z.object({
  content: z.string().min(1).max(2000).optional(),
  status: z.enum(['pending', 'in_progress', 'done', 'cancelled']).optional(),
  tags: z.array(z.string()).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});

export function registerTodosRoutes(app: FastifyInstance): void {
  // ========== List todos for project ==========

  app.get('/api/todos', async (req, reply) => {
    const { projectDir } = req.query as { projectDir?: string };
    if (!projectDir) {
      return reply.code(400).send({ status: 'error', error: 'projectDir query param required' });
    }
    const todos = getTodosForProject(projectDir);
    return reply.send({ status: 'ok', data: todos });
  });

  // ========== Check if project has pending todos ==========

  app.get('/api/todos/has-pending', async (req, reply) => {
    const { projectDir } = req.query as { projectDir?: string };
    if (!projectDir) {
      return reply.code(400).send({ status: 'error', error: 'projectDir query param required' });
    }
    return reply.send({ status: 'ok', data: { hasPending: hasPendingTodos(projectDir) } });
  });

  // ========== Create todo ==========

  app.post('/api/todos', async (req, reply) => {
    const result = CreateTodoSchema.safeParse(req.body);
    if (!result.success) {
      return reply.code(400).send({ status: 'error', error: result.error.message });
    }
    const { projectDir, type, content, tags, priority } = result.data;
    const todo = createTodo(projectDir, type, content, { tags, priority });
    return reply.code(201).send({ status: 'ok', data: todo });
  });

  // ========== Update todo ==========

  app.patch('/api/todos/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = UpdateTodoSchema.safeParse(req.body);
    if (!result.success) {
      return reply.code(400).send({ status: 'error', error: result.error.message });
    }
    const updated = updateTodo(id, result.data);
    if (!updated) {
      return reply.code(404).send({ status: 'error', error: 'Todo not found' });
    }
    return reply.send({ status: 'ok', data: updated });
  });

  // ========== Delete todo ==========

  app.delete('/api/todos/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = deleteTodo(id);
    if (!deleted) {
      return reply.code(404).send({ status: 'error', error: 'Todo not found' });
    }
    return reply.send({ status: 'ok', data: { deleted: true } });
  });
}

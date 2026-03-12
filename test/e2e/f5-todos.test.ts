import { test, expect } from 'playwright/test';
import { startTestServer, type ServerHandle } from './helpers.js';
import { randomInt } from 'node:crypto';

// Dedicated port to avoid conflicts when workers run files in parallel
const PORT = 13340;
const PASSWORD = 'testpass_f5_' + randomInt(10000, 99999);

let server: ServerHandle;

test.beforeAll(async () => {
  server = await startTestServer(PORT, PASSWORD);
});

test.afterAll(async () => {
  await server?.stop();
});

const makeAuth = () => ({
  Authorization: 'Basic ' + Buffer.from('admin:' + PASSWORD).toString('base64'),
  'Content-Type': 'application/json',
});

test('F5: create and list todos for a project', async ({ request }) => {
  const base = `http://localhost:${PORT}`;

  // Create a todo
  const createRes = await request.post(`${base}/api/todos`, {
    headers: makeAuth(),
    data: {
      projectDir: '/tmp/e2e-test-project',
      type: 'todo',
      content: 'E2E test todo item',
    },
  });
  expect(createRes.status()).toBe(201);
  const created = await createRes.json();
  expect(created.data.id).toBeDefined();
  expect(created.data.status).toBe('pending');

  const todoId = created.data.id as string;

  // List todos
  const listRes = await request.get(`${base}/api/todos?projectDir=/tmp/e2e-test-project`, {
    headers: makeAuth(),
  });
  expect(listRes.status()).toBe(200);
  const list = await listRes.json();
  expect(list.data.length).toBeGreaterThanOrEqual(1);

  // Check has-pending
  const pendingRes = await request.get(`${base}/api/todos/has-pending?projectDir=/tmp/e2e-test-project`, {
    headers: makeAuth(),
  });
  expect(pendingRes.status()).toBe(200);
  expect((await pendingRes.json()).data.hasPending).toBe(true);

  // Update to done
  const updateRes = await request.patch(`${base}/api/todos/${todoId}`, {
    headers: makeAuth(),
    data: { status: 'done' },
  });
  expect(updateRes.status()).toBe(200);
  expect((await updateRes.json()).data.status).toBe('done');

  // Delete (no Content-Type header for DELETE to avoid Fastify body parse issues)
  const deleteRes = await request.delete(`${base}/api/todos/${todoId}`, {
    headers: { Authorization: 'Basic ' + Buffer.from('admin:' + PASSWORD).toString('base64') },
  });
  expect(deleteRes.status()).toBe(200);
});

test('F5: has-pending returns false when no todos', async ({ request }) => {
  const res = await request.get(`http://localhost:${PORT}/api/todos/has-pending?projectDir=/tmp/no-todos-here`, {
    headers: makeAuth(),
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).data.hasPending).toBe(false);
});

test('F5: invalid todo creation returns 400', async ({ request }) => {
  const res = await request.post(`http://localhost:${PORT}/api/todos`, {
    headers: makeAuth(),
    data: { type: 'invalid_type', content: '' },
  });
  expect(res.status()).toBe(400);
});

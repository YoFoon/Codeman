import { test, expect } from 'playwright/test';
import { type ServerHandle, startTestServer } from './helpers.js';
import { randomInt } from 'node:crypto';

// Dedicated port to avoid conflicts when workers run files in parallel
const PORT = 13338;
const PASSWORD = 'testpass_f3_' + randomInt(10000, 99999);

let server: ServerHandle;

test.beforeAll(async () => {
  server = await startTestServer(PORT, PASSWORD);
});

test.afterAll(async () => {
  await server?.stop();
});

test('F3: GET /api/system/resources returns memory and CPU data', async ({ request }) => {
  const res = await request.get(`http://localhost:${PORT}/api/system/resources`, {
    headers: { Authorization: 'Basic ' + Buffer.from('admin:' + PASSWORD).toString('base64') },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
  expect(body.data).toHaveProperty('memoryUsedPercent');
  expect(body.data).toHaveProperty('cpuLoadPercent');
  expect(body.data).toHaveProperty('availableMemoryMB');
  expect(typeof body.data.memoryUsedPercent).toBe('number');
  expect(body.data.memoryUsedPercent).toBeGreaterThanOrEqual(0);
  expect(body.data.memoryUsedPercent).toBeLessThanOrEqual(100);
});

test('F3: resource data reflects memory threshold logic', async ({ request }) => {
  const res = await request.get(`http://localhost:${PORT}/api/system/resources`, {
    headers: { Authorization: 'Basic ' + Buffer.from('admin:' + PASSWORD).toString('base64') },
  });
  const body = await res.json();
  // availableMemoryMB indicates how much memory is free for new sessions
  expect(typeof body.data.availableMemoryMB).toBe('number');
  expect(body.data.availableMemoryMB).toBeGreaterThanOrEqual(0);
});

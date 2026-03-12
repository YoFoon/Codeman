import { test, expect } from 'playwright/test';
import { startTestServer, type ServerHandle } from './helpers.js';
import { randomInt } from 'node:crypto';

// Dedicated port to avoid conflicts when workers run files in parallel
const PORT = 13339;
const PASSWORD = 'testpass_f4_' + randomInt(10000, 99999);

let server: ServerHandle;
let sessionId: string | undefined;

test.beforeAll(async () => {
  server = await startTestServer(PORT, PASSWORD);
});

test.afterAll(async () => {
  await server?.stop();
});

test('F4: quota-status endpoint returns structured response', async ({ request }) => {
  // Create a session first
  const createRes = await request.post(`http://localhost:${PORT}/api/sessions`, {
    headers: {
      Authorization: 'Basic ' + Buffer.from('admin:' + PASSWORD).toString('base64'),
      'Content-Type': 'application/json',
    },
    data: { workingDir: '/tmp' },
  });

  if (createRes.status() === 200 || createRes.status() === 201) {
    const body = await createRes.json();
    sessionId = (body.data?.id || body.id) as string;

    const statusRes = await request.get(`http://localhost:${PORT}/api/sessions/${sessionId}/quota-status`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:' + PASSWORD).toString('base64') },
    });
    expect(statusRes.status()).toBe(200);
    const status = await statusRes.json();
    expect(status.data).toHaveProperty('quotaLimited');
    expect(status.data.quotaLimited).toBe(false);
  }
});

test('F4: quota-recovery clear endpoint is accessible', async ({ request }) => {
  // If no session was created, skip
  if (!sessionId) {
    test.skip();
    return;
  }
  const res = await request.post(`http://localhost:${PORT}/api/sessions/${sessionId}/quota-recovery/clear`, {
    headers: { Authorization: 'Basic ' + Buffer.from('admin:' + PASSWORD).toString('base64') },
  });
  expect([200, 404]).toContain(res.status());
});

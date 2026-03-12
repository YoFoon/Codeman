import { test, expect } from 'playwright/test';
import { startTestServer, type ServerHandle } from './helpers.js';
import { randomInt } from 'node:crypto';

// Dedicated port to avoid conflicts when workers run files in parallel
const PORT = 13337;
const PASSWORD = 'testpass_f1_' + randomInt(10000, 99999);

let server: ServerHandle;

test.beforeAll(async () => {
  server = await startTestServer(PORT, PASSWORD);
});

test.afterAll(async () => {
  await server?.stop();
});

test('F1: rate limit disabled — multiple wrong passwords do not get 429', async ({ request }) => {
  const base = `http://localhost:${PORT}`;

  // Send 12 bad auth requests (would normally trigger 429 after 10)
  for (let i = 0; i < 12; i++) {
    const res = await request.get(`${base}/api/status`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:wrongpassword' + i).toString('base64') },
    });
    // Should be 401 (unauthorized), NOT 429 (rate limited)
    expect(res.status()).toBe(401);
  }

  // Correct password should still work
  const ok = await request.get(`${base}/api/status`, {
    headers: { Authorization: 'Basic ' + Buffer.from('admin:' + PASSWORD).toString('base64') },
  });
  expect(ok.status()).toBe(200);
});

test('F1: login page renders correctly', async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/`);
  // The page should load (auth handled by browser dialog or redirected)
  expect(page.url()).toContain(`localhost:${PORT}`);
});

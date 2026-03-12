import { type Page } from 'playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomInt } from 'node:crypto';

export const TEST_PORT = 13337;
export const TEST_PASSWORD = 'testpass_e2e_' + randomInt(10000, 99999);
export const BASE_URL = `http://localhost:${TEST_PORT}`;

export interface ServerHandle {
  process: ChildProcess;
  stop: () => Promise<void>;
}

export async function startTestServer(
  port: number = TEST_PORT,
  password: string = TEST_PASSWORD
): Promise<ServerHandle> {
  const proc = spawn('/snap/node/current/bin/node', ['dist/index.js', 'web', '--port', String(port)], {
    cwd: '/home/zhouyuan/.codeman/app',
    env: {
      ...process.env,
      CODEMAN_PASSWORD: password,
      CODEMAN_DISABLE_RATE_LIMIT: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  });

  // Wait for server to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 15000);
    const onData = (data: Buffer) => {
      if (data.toString().includes('running at')) {
        clearTimeout(timeout);
        proc.stdout?.off('data', onData);
        proc.stderr?.off('data', onData);
        resolve();
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with code ${code}`));
    });
  });

  return {
    process: proc,
    stop: () =>
      new Promise<void>((resolve) => {
        proc.kill('SIGTERM');
        proc.on('exit', () => resolve());
        setTimeout(resolve, 3000);
      }),
  };
}

export async function loginWithBasicAuth(
  page: Page,
  port: number = TEST_PORT,
  password: string = TEST_PASSWORD
): Promise<void> {
  await page.goto(`http://admin:${password}@localhost:${port}/`);
  // Wait for app to initialize
  await page.waitForSelector('.tab-bar, #terminalContainer, .sessions-container', { timeout: 10000 });
}

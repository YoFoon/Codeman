/**
 * Tests for resource-monitor module — verifies memory/CPU threshold checks.
 * Mocks node:os to simulate various resource usage scenarios.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';

vi.mock('node:os');

const CPU_INFO = new Array(2).fill({
  model: 'CPU',
  speed: 2000,
  times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
});

describe('resource-monitor', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(os.cpus).mockReturnValue(CPU_INFO);
  });

  it('returns ok when resources are within limits', async () => {
    vi.mocked(os.totalmem).mockReturnValue(8 * 1024 * 1024 * 1024);
    vi.mocked(os.freemem).mockReturnValue(4 * 1024 * 1024 * 1024); // 50% used
    vi.mocked(os.loadavg).mockReturnValue([0.5, 0.5, 0.5]); // 25% load on 2 cores

    const { checkResourceAvailability } = await import('../src/resource-monitor.js');
    expect(checkResourceAvailability()).toBeNull();
  });

  it('returns error when memory exceeds 90%', async () => {
    vi.mocked(os.totalmem).mockReturnValue(8 * 1024 * 1024 * 1024);
    vi.mocked(os.freemem).mockReturnValue(0.5 * 1024 * 1024 * 1024); // ~93.75% used
    vi.mocked(os.loadavg).mockReturnValue([0.1, 0.1, 0.1]); // low CPU

    const { checkResourceAvailability } = await import('../src/resource-monitor.js');
    const result = checkResourceAvailability();
    expect(result).not.toBeNull();
    expect(result).toContain('内存使用率');
    expect(result).toContain('90%');
  });

  it('returns error when CPU load exceeds 90%', async () => {
    vi.mocked(os.totalmem).mockReturnValue(8 * 1024 * 1024 * 1024);
    vi.mocked(os.freemem).mockReturnValue(6 * 1024 * 1024 * 1024); // 25% used
    vi.mocked(os.loadavg).mockReturnValue([1.9, 1.5, 1.2]); // 95% on 2 cores

    const { checkResourceAvailability } = await import('../src/resource-monitor.js');
    const result = checkResourceAvailability();
    expect(result).not.toBeNull();
    expect(result).toContain('CPU 负载');
    expect(result).toContain('90%');
  });

  it('getResourceUsage returns correct field structure', async () => {
    vi.mocked(os.totalmem).mockReturnValue(4 * 1024 * 1024 * 1024);
    vi.mocked(os.freemem).mockReturnValue(2 * 1024 * 1024 * 1024);
    vi.mocked(os.loadavg).mockReturnValue([1.0, 1.0, 1.0]);

    const { getResourceUsage } = await import('../src/resource-monitor.js');
    const usage = getResourceUsage();

    expect(usage).toHaveProperty('memoryUsedPercent');
    expect(usage).toHaveProperty('cpuLoadPercent');
    expect(usage).toHaveProperty('availableMemoryMB');
    expect(usage).toHaveProperty('totalMemoryMB');
    expect(usage).toHaveProperty('cpuCores');
    expect(usage).toHaveProperty('loadAvg1m');

    expect(usage.memoryUsedPercent).toBeCloseTo(50, 1);
    expect(usage.totalMemoryMB).toBeCloseTo(4096, 0);
    expect(usage.availableMemoryMB).toBeCloseTo(2048, 0);
    expect(usage.cpuCores).toBe(2);
    expect(usage.loadAvg1m).toBe(1.0);
    // cpuLoadPercent = 1.0 / 2 * 100 = 50%
    expect(usage.cpuLoadPercent).toBeCloseTo(50, 1);
  });

  it('memory check takes priority over CPU when both exceed threshold', async () => {
    vi.mocked(os.totalmem).mockReturnValue(8 * 1024 * 1024 * 1024);
    vi.mocked(os.freemem).mockReturnValue(0.4 * 1024 * 1024 * 1024); // ~95% used
    vi.mocked(os.loadavg).mockReturnValue([2.0, 2.0, 2.0]); // 100% load

    const { checkResourceAvailability } = await import('../src/resource-monitor.js');
    const result = checkResourceAvailability();
    expect(result).not.toBeNull();
    // Memory is checked first
    expect(result).toContain('内存使用率');
  });
});

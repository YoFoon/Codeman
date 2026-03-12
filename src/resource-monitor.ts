/**
 * @fileoverview Global resource monitor — tracks system memory and CPU usage.
 * Used to prevent new session creation when system is under heavy load.
 *
 * @module resource-monitor
 */
import os from 'node:os';

export interface ResourceUsage {
  memoryUsedPercent: number; // 0-100
  cpuLoadPercent: number; // 0-100 (1-min load avg as % of CPU cores)
  availableMemoryMB: number;
  totalMemoryMB: number;
  cpuCores: number;
  loadAvg1m: number;
}

/** Maximum allowed resource usage before rejecting new sessions */
export const RESOURCE_THRESHOLD_PERCENT = 90;

/**
 * Read current system memory and CPU usage via Node.js os module.
 * Returns usage as percentages and raw values.
 */
export function getResourceUsage(): ResourceUsage {
  const totalMemoryMB = os.totalmem() / 1024 / 1024;
  const freeMemoryMB = os.freemem() / 1024 / 1024;
  const usedMemoryMB = totalMemoryMB - freeMemoryMB;
  const memoryUsedPercent = (usedMemoryMB / totalMemoryMB) * 100;

  const cpuCores = os.cpus().length;
  const loadAvg1m = os.loadavg()[0];
  // CPU load: 1-min average / cpu cores * 100
  const cpuLoadPercent = (loadAvg1m / cpuCores) * 100;

  return {
    memoryUsedPercent,
    cpuLoadPercent,
    availableMemoryMB: freeMemoryMB,
    totalMemoryMB,
    cpuCores,
    loadAvg1m,
  };
}

/**
 * Check if system resources are within acceptable limits.
 * Returns null if OK, or a user-friendly error message if over threshold.
 */
export function checkResourceAvailability(): string | null {
  const usage = getResourceUsage();

  if (usage.memoryUsedPercent >= RESOURCE_THRESHOLD_PERCENT) {
    return `内存使用率 ${usage.memoryUsedPercent.toFixed(1)}% 超过 ${RESOURCE_THRESHOLD_PERCENT}% 上限，无法创建新 session（可用内存: ${usage.availableMemoryMB.toFixed(0)}MB）`;
  }

  if (usage.cpuLoadPercent >= RESOURCE_THRESHOLD_PERCENT) {
    return `CPU 负载 ${usage.cpuLoadPercent.toFixed(1)}% 超过 ${RESOURCE_THRESHOLD_PERCENT}% 上限，无法创建新 session（负载均值: ${usage.loadAvg1m.toFixed(2)}）`;
  }

  return null;
}

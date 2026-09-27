import Redis from 'ioredis';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (err) => {
  logger.error({ error: err.message }, 'Redis error');
});

export async function initializeRedis(): Promise<void> {
  try {
    await redis.ping();
    logger.info('Redis initialization complete');
  } catch (error) {
    logger.error({ error: String(error) }, 'Redis initialization failed');
    throw error;
  }
}

// Stream names
export const STREAMS = {
  TELEMETRY: 'telemetry:stream',
  ALERTS: 'alerts:stream',
  INCIDENTS: 'incidents:stream',
  COMMANDS: 'commands:stream',
  COMMAND_RESULTS: 'command-results:stream',
  AI_EVENTS: 'ai-events:stream',
} as const;

// BullMQ queues
export const QUEUES = {
  TELEMETRY_STORAGE: 'telemetry-storage',
  ANOMALY_DETECTION: 'anomaly-detection',
  ALERT_ENGINE: 'alert-engine',
  INCIDENT_CORRELATION: 'incident-correlation',
  AI_INVESTIGATION: 'ai-investigation',
  COMMAND_EXECUTION: 'command-execution',
  AGGREGATION: 'telemetry-aggregation',
} as const;

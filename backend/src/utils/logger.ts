import pino from 'pino';
import { config } from '../config/index.js';

const isDev = config.nodeEnv === 'development';

const pinoOptions: pino.LoggerOptions = {
  level: config.logLevel,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

if (isDev) {
  pinoOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  };
}

export const logger = pino(pinoOptions);

export function createRequestLogger(requestId: string) {
  return logger.child({ request_id: requestId });
}

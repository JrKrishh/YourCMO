import pino from 'pino';
import { getEnvOrDefault } from './env';

const level = getEnvOrDefault('LOG_LEVEL', 'info');

/**
 * Application logger using pino.
 * Configured via LOG_LEVEL environment variable.
 */
export const logger = pino({
  level,
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
});

/**
 * Creates a child logger with a component name for scoped logging.
 */
export function createLogger(component: string): pino.Logger {
  return logger.child({ component });
}

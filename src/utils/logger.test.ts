import { describe, it, expect } from 'vitest';
import { logger, createLogger } from './logger';

describe('logger', () => {
  it('exports a pino logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('creates a child logger with component name', () => {
    const child = createLogger('TestComponent');
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
  });
});

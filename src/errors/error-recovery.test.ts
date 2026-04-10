import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retryWithBackoff, withFallback, CircuitBreaker, CircuitState } from './error-recovery';

// Speed up tests by mocking timers
beforeEach(() => {
  vi.restoreAllMocks();
});

describe('retryWithBackoff', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, { baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max attempts exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(retryWithBackoff(fn, { maxAttempts: 2, baseDelayMs: 1 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('skips retry for non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    const isRetryable = () => false;
    await expect(retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 1, isRetryable })).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('handles non-Error throws', async () => {
    const fn = vi.fn().mockRejectedValue('string error');
    await expect(retryWithBackoff(fn, { maxAttempts: 1, baseDelayMs: 1 })).rejects.toThrow('string error');
  });
});

describe('withFallback', () => {
  it('returns primary result on success', async () => {
    const result = await withFallback(() => Promise.resolve('primary'), 'fallback');
    expect(result).toBe('primary');
  });

  it('returns fallback value on failure', async () => {
    const result = await withFallback(() => Promise.reject(new Error('fail')), 'fallback');
    expect(result).toBe('fallback');
  });

  it('calls fallback function on failure', async () => {
    const result = await withFallback(() => Promise.reject(new Error('fail')), () => 'computed');
    expect(result).toBe('computed');
  });

  it('calls async fallback function on failure', async () => {
    const result = await withFallback(
      () => Promise.reject(new Error('fail')),
      () => Promise.resolve('async-fallback'),
    );
    expect(result).toBe('async-fallback');
  });
});

describe('CircuitBreaker', () => {
  it('starts in CLOSED state', () => {
    const cb = new CircuitBreaker('test');
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('executes function in CLOSED state', async () => {
    const cb = new CircuitBreaker('test');
    const result = await cb.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('opens after reaching failure threshold', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 2 });
    const fail = () => Promise.reject(new Error('fail'));

    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.CLOSED);

    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.OPEN);
  });

  it('rejects calls when OPEN', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow('Circuit breaker "test" is OPEN');
  });

  it('transitions to HALF_OPEN after reset timeout', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1, resetTimeoutMs: 10 });
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.OPEN);

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 15));
    expect(cb.getState()).toBe(CircuitState.HALF_OPEN);
  });

  it('closes on success in HALF_OPEN state', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1, resetTimeoutMs: 10 });
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

    await new Promise((r) => setTimeout(r, 15));
    expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('re-opens on failure in HALF_OPEN state', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1, resetTimeoutMs: 10, halfOpenMaxAttempts: 1 });
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

    await new Promise((r) => setTimeout(r, 15));
    expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

    await expect(cb.execute(() => Promise.reject(new Error('fail again')))).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.OPEN);
  });

  it('resets state manually', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.OPEN);

    cb.reset();
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('resets failure count on success', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 3 });
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

    // Success resets count
    await cb.execute(() => Promise.resolve('ok'));

    // These two failures should not open the circuit (count was reset)
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });
});

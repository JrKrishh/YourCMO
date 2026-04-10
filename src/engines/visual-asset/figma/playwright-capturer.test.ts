import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NavigationStep } from './frame-manifest';

// ─── Mock Playwright ─────────────────────────────────────────────────────────

const mockScreenshot = vi.fn();
const mockGoto = vi.fn();
const mockClick = vi.fn();
const mockWaitForSelector = vi.fn();
const mockWaitForTimeout = vi.fn();
const mockUrl = vi.fn().mockReturnValue('https://example.com');
const mockNewPage = vi.fn();
const mockNewContext = vi.fn();
const mockClose = vi.fn();
const mockLaunch = vi.fn();

vi.mock('playwright', () => ({
  chromium: {
    launch: (...args: unknown[]) => mockLaunch(...args),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupMocks(overrides?: { screenshotResult?: Buffer; launchError?: Error; selectorError?: boolean }) {
  const screenshotBuf = overrides?.screenshotResult ?? Buffer.from('fake-png-data');

  mockScreenshot.mockResolvedValue(screenshotBuf);
  mockGoto.mockResolvedValue(undefined);
  mockClick.mockResolvedValue(undefined);
  mockWaitForTimeout.mockResolvedValue(undefined);
  mockUrl.mockReturnValue('https://example.com/app');

  if (overrides?.selectorError) {
    mockWaitForSelector.mockRejectedValue(new Error('Timeout'));
  } else {
    mockWaitForSelector.mockResolvedValue(undefined);
  }

  const page = {
    screenshot: mockScreenshot,
    goto: mockGoto,
    click: mockClick,
    waitForSelector: mockWaitForSelector,
    waitForTimeout: mockWaitForTimeout,
    url: mockUrl,
  };

  mockNewPage.mockResolvedValue(page);
  mockNewContext.mockResolvedValue({ newPage: mockNewPage });
  mockClose.mockResolvedValue(undefined);

  if (overrides?.launchError) {
    mockLaunch.mockRejectedValue(overrides.launchError);
  } else {
    mockLaunch.mockResolvedValue({
      newContext: mockNewContext,
      close: mockClose,
    });
  }
}

function resetMocks() {
  mockScreenshot.mockReset();
  mockGoto.mockReset();
  mockClick.mockReset();
  mockWaitForSelector.mockReset();
  mockWaitForTimeout.mockReset();
  mockUrl.mockReset();
  mockNewPage.mockReset();
  mockNewContext.mockReset();
  mockClose.mockReset();
  mockLaunch.mockReset();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PlaywrightCapturer', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('closes browser when capture throws an error', async () => {
    setupMocks({ selectorError: true });

    const { PlaywrightCapturer } = await import('./playwright-capturer');
    const capturer = new PlaywrightCapturer({ timeout: 5000 });

    const steps: NavigationStep[] = [
      { action: 'navigate', url: 'https://example.com/app', screenName: 'home' },
      { action: 'click', selector: '#missing-button', screenName: 'home' },
    ];

    await expect(capturer.capture(steps)).rejects.toThrow();

    // Browser close must be called even on error
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('throws error with selector and URL when selector times out', async () => {
    setupMocks({ selectorError: true });

    const { PlaywrightCapturer } = await import('./playwright-capturer');
    const capturer = new PlaywrightCapturer({ timeout: 5000 });

    const steps: NavigationStep[] = [
      { action: 'navigate', url: 'https://example.com/prototype', screenName: 'nav' },
      { action: 'click', selector: '.non-existent', screenName: 'click-step' },
    ];

    await expect(capturer.capture(steps)).rejects.toThrow(
      /\.non-existent.*https:\/\/example\.com\/prototype|https:\/\/example\.com\/prototype.*\.non-existent/,
    );
  });

  it('returns CaptureResult with correct fields on successful capture', async () => {
    const fakePng = Buffer.from('fake-screenshot-png');
    setupMocks({ screenshotResult: fakePng });

    const { PlaywrightCapturer } = await import('./playwright-capturer');
    const capturer = new PlaywrightCapturer({ viewportWidth: 400, viewportHeight: 800 });

    const steps: NavigationStep[] = [
      { action: 'navigate', url: 'https://example.com/app', screenName: 'home' },
      { action: 'wait', waitMs: 100, screenName: 'wait-step' },
      { action: 'screenshot', screenName: 'home-screen' },
    ];

    const results = await capturer.capture(steps);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      screenName: 'home-screen',
      imageBuffer: expect.any(Buffer),
      dimensions: { width: 400, height: 800 },
    });
    expect(results[0].imageBuffer.length).toBeGreaterThan(0);
  });

  it('closes browser when launch itself succeeds but context creation fails', async () => {
    // Browser launches fine but newContext throws
    mockClose.mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({
      newContext: vi.fn().mockRejectedValue(new Error('Context creation failed')),
      close: mockClose,
    });

    const { PlaywrightCapturer } = await import('./playwright-capturer');
    const capturer = new PlaywrightCapturer();

    await expect(capturer.capture([{ action: 'screenshot', screenName: 'test' }])).rejects.toThrow(
      'Context creation failed',
    );

    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});

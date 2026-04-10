import type { Dimensions } from '../../../models/common';
import type { NavigationStep } from './frame-manifest';

/** Configuration for the Playwright capturer */
export interface PlaywrightCapturerConfig {
  /** Viewport width in pixels (default: 390) */
  viewportWidth?: number;
  /** Viewport height in pixels (default: 844) */
  viewportHeight?: number;
  /** Selector timeout in milliseconds (default: 10000) */
  timeout?: number;
}

/** Result of a single screenshot capture */
export interface CaptureResult {
  screenName: string;
  imageBuffer: Buffer;
  dimensions: Dimensions;
}

/**
 * Captures screenshots from Figma prototype links or deployed app URLs
 * using Playwright headless Chromium.
 *
 * Playwright is treated as an optional peer dependency — it is dynamically
 * imported at capture time so the module can be loaded even when Playwright
 * is not installed.
 */
export class PlaywrightCapturer {
  private readonly viewportWidth: number;
  private readonly viewportHeight: number;
  private readonly timeout: number;

  constructor(config?: PlaywrightCapturerConfig) {
    this.viewportWidth = config?.viewportWidth ?? 390;
    this.viewportHeight = config?.viewportHeight ?? 844;
    this.timeout = config?.timeout ?? 10_000;
  }

  /**
   * Execute navigation steps sequentially and capture screenshots.
   * Launches a headless Chromium browser, runs each step, and returns
   * a CaptureResult for every `screenshot` action encountered.
   */
  async capture(steps: NavigationStep[]): Promise<CaptureResult[]> {
    const { chromium } = await import('playwright');

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: this.viewportWidth, height: this.viewportHeight },
      });
      const page = await context.newPage();

      const results: CaptureResult[] = [];
      let currentUrl = '';

      for (const step of steps) {
        switch (step.action) {
          case 'navigate': {
            if (step.url) {
              currentUrl = step.url;
              await page.goto(step.url, { waitUntil: 'networkidle' });
            }
            break;
          }
          case 'click': {
            if (step.selector) {
              try {
                await page.waitForSelector(step.selector, { timeout: this.timeout });
              } catch {
                throw new Error(
                  `Selector "${step.selector}" not found within ${this.timeout}ms on ${currentUrl || page.url()}`,
                );
              }
              await page.click(step.selector);
            }
            break;
          }
          case 'wait': {
            if (step.waitMs && step.waitMs > 0) {
              await page.waitForTimeout(step.waitMs);
            }
            break;
          }
          case 'screenshot': {
            const buffer = await page.screenshot({ type: 'png' });
            results.push({
              screenName: step.screenName,
              imageBuffer: Buffer.from(buffer),
              dimensions: {
                width: this.viewportWidth,
                height: this.viewportHeight,
              },
            });
            break;
          }
        }
      }

      return results;
    } finally {
      await browser.close();
    }
  }
}

import { readFileSync } from 'fs';
import { resolve } from 'path';

/** A single navigation step for Playwright-based capture */
export interface NavigationStep {
  action: 'navigate' | 'click' | 'wait' | 'screenshot';
  selector?: string;
  url?: string;
  waitMs?: number;
  screenName: string;
}

/** A single entry in the frame manifest */
export interface FrameManifestEntry {
  screenName: string;
  figmaNodeId?: string;
  playwrightSteps?: NavigationStep[];
  description?: string;
  tags?: string[];
}

/** The top-level frame manifest structure */
export interface FrameManifest {
  figmaFileKey: string;
  prototypeUrl?: string;
  frames: FrameManifestEntry[];
}

const DEFAULT_MANIFEST_PATH = resolve(__dirname, '../../../config/figma-frame-manifest.json');

/**
 * Load and parse the frame manifest from a JSON file.
 * @param path - Path to the manifest JSON file (defaults to src/config/figma-frame-manifest.json)
 */
export function loadFrameManifest(path?: string): FrameManifest {
  const manifestPath = path ?? DEFAULT_MANIFEST_PATH;
  const raw = readFileSync(manifestPath, 'utf-8');
  const manifest: FrameManifest = JSON.parse(raw);
  validateFrameManifest(manifest);
  return manifest;
}

/**
 * Validate that each manifest entry has a screenName and at least one extraction method.
 * Throws a descriptive error identifying any invalid entries.
 */
export function validateFrameManifest(manifest: FrameManifest): void {
  for (const entry of manifest.frames) {
    if (!entry.screenName || entry.screenName.trim() === '') {
      throw new Error('Frame manifest entry is missing a screenName');
    }
    if (!entry.figmaNodeId && (!entry.playwrightSteps || entry.playwrightSteps.length === 0)) {
      throw new Error(
        `Frame manifest entry "${entry.screenName}" must have at least one of figmaNodeId or playwrightSteps`,
      );
    }
  }
}

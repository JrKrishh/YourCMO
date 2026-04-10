/**
 * Accessibility utilities for visual assets.
 * Generates alt text for images and captions for videos.
 */

/**
 * Generates descriptive alt text for an image based on the prompt
 * and optional context. In production, this could use a vision model
 * to describe the actual generated image.
 */
export function generateAltText(prompt: string, brandName?: string): string {
  if (!prompt || prompt.trim().length === 0) {
    return '';
  }

  const cleaned = prompt.trim();
  const prefix = brandName ? `${brandName}: ` : '';
  // Cap alt text at 125 characters (screen reader best practice)
  const maxLen = 125 - prefix.length;
  const text = cleaned.length > maxLen ? cleaned.substring(0, maxLen - 3) + '...' : cleaned;
  return `${prefix}${text}`;
}

/**
 * Generates captions/subtitles for a video based on the script or prompt.
 * Returns a simple SRT-style caption string.
 * In production, this could use speech-to-text on the actual video.
 */
export function generateCaptions(script: string, durationSeconds?: number): string {
  if (!script || script.trim().length === 0) {
    return '';
  }

  const sentences = script
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return '';
  }

  const totalDuration = durationSeconds ?? sentences.length * 3;
  const segmentDuration = totalDuration / sentences.length;

  const lines: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const startSec = i * segmentDuration;
    const endSec = (i + 1) * segmentDuration;
    lines.push(`${i + 1}`);
    lines.push(`${formatTimestamp(startSec)} --> ${formatTimestamp(endSec)}`);
    lines.push(sentences[i]);
    lines.push('');
  }

  return lines.join('\n').trim();
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad3(ms)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0');
}

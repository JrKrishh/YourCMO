/**
 * Watermark utility — composites the brand logo onto images and videos.
 *
 * Uses sharp for images and ffmpeg-static for videos.
 * The logo is placed in the bottom-right corner with configurable opacity and padding.
 */
import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../utils/logger';

const execFileAsync = promisify(execFile);
const log = createLogger('Watermark');

// Logo path — try brand-logo first, fall back to any logo in assets
const DEFAULT_LOGO_PATH = fs.existsSync(path.resolve(__dirname, '../../../assets/brand-logo.png'))
  ? path.resolve(__dirname, '../../../assets/brand-logo.png')
  : fs.existsSync(path.resolve(__dirname, '../../../assets/brand-logo.jpg'))
    ? path.resolve(__dirname, '../../../assets/brand-logo.jpg')
    : path.resolve(__dirname, '../../../assets/logo.png');

export interface WatermarkOptions {
  logoPath?: string;
  /** Logo width in pixels (height auto-scaled) */
  logoSize?: number;
  /** Padding from bottom-right corner in pixels */
  padding?: number;
  /** Opacity 0-1 */
  opacity?: number;
  /** Text overlays to add to video (rendered by ffmpeg, not AI) */
  textOverlays?: TextOverlay[];
}

export interface TextOverlay {
  text: string;
  /** Position: 'bottom-center', 'top-center', 'bottom-left' */
  position: 'bottom-center' | 'top-center' | 'bottom-left';
  /** Font size in pixels */
  fontSize?: number;
  /** Hex color like 'white' or 'FFFFFF' */
  color?: string;
  /** Show from this second */
  startTime?: number;
  /** Show until this second (0 = entire video) */
  endTime?: number;
}

const DEFAULTS: Required<Omit<WatermarkOptions, 'textOverlays'>> & { textOverlays: TextOverlay[] } = {
  logoPath: DEFAULT_LOGO_PATH,
  logoSize: 80,
  padding: 20,
  opacity: 0.85,
  textOverlays: [],
};

/**
 * Add brand logo watermark to an image buffer.
 * Returns the watermarked image buffer.
 */
export async function watermarkImage(
  imageBuffer: Buffer,
  options?: WatermarkOptions,
): Promise<Buffer> {
  const opts = { ...DEFAULTS, ...options };

  if (!fs.existsSync(opts.logoPath)) {
    log.warn({ logoPath: opts.logoPath }, 'Logo file not found, skipping watermark');
    return imageBuffer;
  }

  const logo = await sharp(opts.logoPath)
    .resize(opts.logoSize)
    .ensureAlpha()
    .toBuffer();

  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const w = metadata.width ?? 1080;
  const h = metadata.height ?? 1080;

  const logoMeta = await sharp(logo).metadata();
  const lw = logoMeta.width ?? opts.logoSize;
  const lh = logoMeta.height ?? opts.logoSize;

  const result = await image
    .composite([{
      input: logo,
      top: h - lh - opts.padding,
      left: w - lw - opts.padding,
    }])
    .toBuffer();

  log.info({ width: w, height: h, logoSize: opts.logoSize }, 'Image watermarked');
  return result;
}

/**
 * Add brand logo watermark to a video file using ffmpeg.
 * Downloads the video, overlays the logo, saves the result.
 * Returns the path to the watermarked video.
 */
export async function watermarkVideo(
  videoUrl: string,
  outputPath: string,
  options?: WatermarkOptions,
): Promise<string> {
  const opts = { ...DEFAULTS, ...options };

  if (!fs.existsSync(opts.logoPath)) {
    log.warn({ logoPath: opts.logoPath }, 'Logo file not found, skipping video watermark');
    // Just download the video as-is
    const res = await fetch(videoUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outputPath, buf);
    return outputPath;
  }

  // Get ffmpeg path from ffmpeg-static
  let ffmpegPath: string;
  try {
    ffmpegPath = require('ffmpeg-static') as string;
  } catch {
    log.warn('ffmpeg-static not available, downloading video without watermark');
    const res = await fetch(videoUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outputPath, buf);
    return outputPath;
  }

  // Download video to temp file
  const tempDir = path.dirname(outputPath);
  const tempVideo = path.join(tempDir, `_temp_${Date.now()}.mp4`);

  log.info('Downloading video for watermarking...');
  const res = await fetch(videoUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tempVideo, buf);

  try {
    // Build filter: logo overlay + text overlays
    const pad = opts.padding;
    let filterComplex = `[1:v]scale=${opts.logoSize}:-1[logo];[0:v][logo]overlay=W-w-${pad}:H-h-${pad}[branded]`;
    let lastLabel = 'branded';

    // Add text overlays via drawtext
    if (opts.textOverlays && opts.textOverlays.length > 0) {
      for (let i = 0; i < opts.textOverlays.length; i++) {
        const t = opts.textOverlays[i];
        const fontSize = t.fontSize ?? 28;
        const color = t.color ?? 'white';
        const escapedText = t.text.replace(/'/g, "'\\''").replace(/:/g, '\\:');

        let x = '(w-text_w)/2'; // bottom-center default
        let y = `h-th-${60 + i * 35}`; // stack text lines with spacing
        if (t.position === 'top-center') { x = '(w-text_w)/2'; y = `${40 + i * 35}`; }
        if (t.position === 'bottom-left') { x = '40'; y = `h-th-${60 + i * 35}`; }

        let enable = '';
        if (t.startTime !== undefined || t.endTime !== undefined) {
          const start = t.startTime ?? 0;
          const end = t.endTime ?? 999;
          enable = `:enable='between(t,${start},${end})'`;
        }

        const nextLabel = `txt${i}`;
        filterComplex += `;[${lastLabel}]drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${color}:x=${x}:y=${y}:shadowcolor=black@0.6:shadowx=2:shadowy=2${enable}[${nextLabel}]`;
        lastLabel = nextLabel;
      }
    }

    // Final output: strip trailing label from last filter, use -map for output
    // The last filter should NOT have an output label — ffmpeg uses it as the default output
    const lastLabelTag = `[${lastLabel}]`;
    const filterStr = filterComplex.endsWith(lastLabelTag)
      ? filterComplex.slice(0, -lastLabelTag.length)
      : filterComplex;

    const args = [
      '-i', tempVideo,
      '-i', opts.logoPath,
      '-filter_complex', filterStr,
      '-codec:a', 'copy',
      '-y',
      outputPath,
    ];

    await execFileAsync(ffmpegPath, args, { timeout: 120000 });

    log.info({ outputPath }, 'Video watermarked with logo and text');
  } catch (err: any) {
    log.warn({ error: err.message }, 'ffmpeg watermark failed, saving original');
    fs.copyFileSync(tempVideo, outputPath);
  } finally {
    fs.unlinkSync(tempVideo);
  }

  return outputPath;
}

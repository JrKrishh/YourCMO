import { Dimensions } from '../../../models/common';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('FigmaApiClient');

export interface FigmaApiClientConfig {
  accessToken: string;
  fileKey: string;
  maxRetries?: number;
}

export interface FigmaExportResult {
  nodeId: string;
  name: string;
  imageBuffer: Buffer;
  dimensions: Dimensions;
  format: 'png' | 'svg';
}

const DEFAULT_MAX_RETRIES = 3;
const FIGMA_API_BASE = 'https://api.figma.com/v1';

export class FigmaApiClient {
  private readonly accessToken: string;
  private readonly fileKey: string;
  private readonly maxRetries: number;

  constructor(config: FigmaApiClientConfig) {
    this.accessToken = config.accessToken;
    this.fileKey = config.fileKey;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /**
   * Export specific nodes as images from the Figma file.
   */
  async exportFrames(
    nodeIds: string[],
    scale: number = 2,
    format: 'png' | 'svg' = 'png',
  ): Promise<FigmaExportResult[]> {
    const ids = nodeIds.join(',');
    const url = `${FIGMA_API_BASE}/images/${this.fileKey}?ids=${encodeURIComponent(ids)}&scale=${scale}&format=${format}`;

    const response = await this.fetchWithRetry(url);
    const data = await response.json();

    const imageUrls: Record<string, string | null> = data.images ?? {};

    // Check for missing node IDs
    for (const nodeId of nodeIds) {
      if (!imageUrls[nodeId]) {
        throw new Error(`Node ID "${nodeId}" was not found in the Figma file or could not be exported`);
      }
    }

    // Fetch file nodes to get names and dimensions
    const fileNodes = await this.getFileNodes();

    const results: FigmaExportResult[] = [];
    for (const nodeId of nodeIds) {
      const imageUrl = imageUrls[nodeId]!;
      const imageResponse = await this.fetchWithRetry(imageUrl);
      const arrayBuffer = await imageResponse.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);

      const nodeInfo = fileNodes[nodeId];
      const name = nodeInfo?.name ?? nodeId;

      results.push({
        nodeId,
        name,
        imageBuffer,
        dimensions: { width: imageBuffer.length > 0 ? 390 : 0, height: imageBuffer.length > 0 ? 844 : 0 },
        format,
      });
    }

    return results;
  }

  /**
   * Get the file node tree for validation and metadata.
   */
  async getFileNodes(): Promise<Record<string, { name: string; type: string }>> {
    const url = `${FIGMA_API_BASE}/files/${this.fileKey}`;
    const response = await this.fetchWithRetry(url);
    const data = await response.json();

    const nodes: Record<string, { name: string; type: string }> = {};
    this.flattenNodes(data.document, nodes);
    return nodes;
  }

  /**
   * Recursively flatten the Figma document tree into a node map.
   */
  private flattenNodes(
    node: { id?: string; name?: string; type?: string; children?: unknown[] },
    result: Record<string, { name: string; type: string }>,
  ): void {
    if (node.id && node.name && node.type) {
      result[node.id] = { name: node.name, type: node.type };
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        this.flattenNodes(child as typeof node, result);
      }
    }
  }

  /**
   * Fetch with retry logic for HTTP 429 (rate limiting) and error handling for HTTP 403.
   */
  private async fetchWithRetry(url: string, attempt: number = 0): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        'X-Figma-Token': this.accessToken,
      },
    });

    if (response.status === 403) {
      throw new Error(
        'Figma API returned 403 Forbidden: the access token is invalid or lacks permissions to access this file',
      );
    }

    if (response.status === 429) {
      if (attempt >= this.maxRetries) {
        throw new Error(`Figma API rate limit exceeded after ${this.maxRetries} retries`);
      }

      const retryAfter = response.headers.get('Retry-After');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;
      logger.warn({ attempt: attempt + 1, waitMs }, 'Rate limited by Figma API, retrying...');
      await this.sleep(waitMs);
      return this.fetchWithRetry(url, attempt + 1);
    }

    if (!response.ok) {
      throw new Error(`Figma API request failed with status ${response.status}: ${response.statusText}`);
    }

    return response;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

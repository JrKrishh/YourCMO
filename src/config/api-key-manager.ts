/**
 * API Key Manager
 * Provides secure storage, validation, rotation support, and usage tracking
 * for API keys used across the marketing agent.
 */

import type { SecretsManager } from './secrets-manager';
import { InMemorySecretsManager } from './secrets-manager';

/** Tracks usage statistics for a single API key. */
export interface ApiKeyUsage {
  key: string;
  totalCalls: number;
  lastUsedAt: Date | null;
  firstUsedAt: Date | null;
}

/** Result of validating all registered keys on startup. */
export interface KeyValidationResult {
  valid: boolean;
  missing: string[];
  expired: string[];
  present: string[];
}

/** Describes a key that should be registered and optionally required. */
export interface KeyRegistration {
  name: string;
  required: boolean;
  /** Optional regex pattern the key value must match. */
  pattern?: RegExp;
}

export class ApiKeyManager {
  private readonly secrets: SecretsManager;
  private readonly registrations: KeyRegistration[] = [];
  private readonly usage = new Map<string, ApiKeyUsage>();

  constructor(secretsManager?: SecretsManager) {
    this.secrets = secretsManager ?? new InMemorySecretsManager();
  }

  /**
   * Register a key that the system expects.
   * Call this during setup before calling validateKeys().
   */
  registerKey(name: string, required: boolean, pattern?: RegExp): void {
    this.registrations.push({ name, required, pattern });
  }

  /**
   * Store an API key securely.
   */
  async setKey(name: string, value: string, expiresAt?: Date): Promise<void> {
    await this.secrets.setSecret(name, value, expiresAt);
  }

  /**
   * Retrieve an API key value. Records usage.
   * Returns undefined if the key doesn't exist or has expired.
   */
  async getKey(name: string): Promise<string | undefined> {
    const secret = await this.secrets.getSecret(name);
    if (!secret) return undefined;

    this.recordUsage(name);
    return secret.value;
  }

  /**
   * Rotate an API key: store the new value, bumping the version.
   */
  async rotateKey(name: string, newValue: string, expiresAt?: Date): Promise<void> {
    await this.secrets.setSecret(name, newValue, expiresAt);
  }

  /**
   * Delete an API key.
   */
  async deleteKey(name: string): Promise<boolean> {
    this.usage.delete(name);
    return this.secrets.deleteSecret(name);
  }

  /**
   * Validate all registered keys on startup.
   * Checks presence, expiration, and optional pattern matching.
   */
  async validateKeys(): Promise<KeyValidationResult> {
    const missing: string[] = [];
    const expired: string[] = [];
    const present: string[] = [];

    for (const reg of this.registrations) {
      // Use getRawSecret to detect expired keys (getSecret filters them out)
      const raw = await this.secrets.getRawSecret(reg.name);

      if (!raw) {
        if (reg.required) {
          missing.push(reg.name);
        }
        continue;
      }

      if (raw.expiresAt && raw.expiresAt <= new Date()) {
        expired.push(reg.name);
        continue;
      }

      if (reg.pattern && !reg.pattern.test(raw.value)) {
        missing.push(reg.name); // treat invalid format as missing
        continue;
      }

      present.push(reg.name);
    }

    return {
      valid: missing.length === 0 && expired.length === 0,
      missing,
      expired,
      present,
    };
  }

  /**
   * Get usage statistics for a specific key.
   */
  getUsage(name: string): ApiKeyUsage | undefined {
    return this.usage.get(name);
  }

  /**
   * Get usage statistics for all tracked keys.
   */
  getAllUsage(): ApiKeyUsage[] {
    return Array.from(this.usage.values());
  }

  /**
   * Bulk-load API keys from a Record (e.g. from env config).
   */
  async loadFromRecord(keys: Record<string, string>): Promise<void> {
    for (const [name, value] of Object.entries(keys)) {
      if (value) {
        await this.secrets.setSecret(name, value);
      }
    }
  }

  private recordUsage(name: string): void {
    const now = new Date();
    const existing = this.usage.get(name);
    if (existing) {
      existing.totalCalls += 1;
      existing.lastUsedAt = now;
    } else {
      this.usage.set(name, {
        key: name,
        totalCalls: 1,
        lastUsedAt: now,
        firstUsedAt: now,
      });
    }
  }
}

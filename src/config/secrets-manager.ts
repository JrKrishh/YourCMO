/**
 * Abstraction layer for secrets management.
 * Supports pluggable backends (AWS Secrets Manager, HashiCorp Vault, etc.)
 * Ships with an in-memory implementation for local development and testing.
 */

export interface SecretValue {
  key: string;
  value: string;
  version: number;
  createdAt: Date;
  expiresAt?: Date;
}

export interface SecretsManager {
  /** Retrieve a secret by key. Returns undefined if not found. */
  getSecret(key: string): Promise<SecretValue | undefined>;

  /** Store or update a secret. Returns the stored SecretValue. */
  setSecret(key: string, value: string, expiresAt?: Date): Promise<SecretValue>;

  /** Delete a secret by key. Returns true if it existed. */
  deleteSecret(key: string): Promise<boolean>;

  /** Check whether a secret exists. */
  hasSecret(key: string): Promise<boolean>;

  /** List all secret keys. */
  listKeys(): Promise<string[]>;

  /** Retrieve the raw secret entry regardless of expiration. */
  getRawSecret(key: string): Promise<SecretValue | undefined>;
}

/**
 * In-memory secrets manager for local development and testing.
 * Secrets are lost when the process exits.
 */
export class InMemorySecretsManager implements SecretsManager {
  private readonly store = new Map<string, SecretValue>();

  async getSecret(key: string): Promise<SecretValue | undefined> {
    const secret = this.store.get(key);
    if (!secret) return undefined;
    if (secret.expiresAt && secret.expiresAt <= new Date()) {
      return undefined;
    }
    return { ...secret };
  }

  /**
   * Retrieve the raw secret entry regardless of expiration.
   * Useful for checking whether a key was ever stored.
   */
  async getRawSecret(key: string): Promise<SecretValue | undefined> {
    const secret = this.store.get(key);
    return secret ? { ...secret } : undefined;
  }

  async setSecret(key: string, value: string, expiresAt?: Date): Promise<SecretValue> {
    const existing = this.store.get(key);
    const version = existing ? existing.version + 1 : 1;
    const secret: SecretValue = {
      key,
      value,
      version,
      createdAt: new Date(),
      expiresAt,
    };
    this.store.set(key, secret);
    return { ...secret };
  }

  async deleteSecret(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async hasSecret(key: string): Promise<boolean> {
    const secret = await this.getSecret(key);
    return secret !== undefined;
  }

  async listKeys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
}

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySecretsManager } from './secrets-manager';

describe('InMemorySecretsManager', () => {
  let sm: InMemorySecretsManager;

  beforeEach(() => {
    sm = new InMemorySecretsManager();
  });

  it('stores and retrieves a secret', async () => {
    await sm.setSecret('MY_KEY', 'my-value');
    const secret = await sm.getSecret('MY_KEY');
    expect(secret).toBeDefined();
    expect(secret!.key).toBe('MY_KEY');
    expect(secret!.value).toBe('my-value');
    expect(secret!.version).toBe(1);
  });

  it('returns undefined for missing key', async () => {
    expect(await sm.getSecret('NOPE')).toBeUndefined();
  });

  it('increments version on update', async () => {
    await sm.setSecret('K', 'v1');
    await sm.setSecret('K', 'v2');
    const secret = await sm.getSecret('K');
    expect(secret!.value).toBe('v2');
    expect(secret!.version).toBe(2);
  });

  it('deletes a secret', async () => {
    await sm.setSecret('K', 'v');
    expect(await sm.deleteSecret('K')).toBe(true);
    expect(await sm.getSecret('K')).toBeUndefined();
  });

  it('returns false when deleting non-existent key', async () => {
    expect(await sm.deleteSecret('NOPE')).toBe(false);
  });

  it('hasSecret returns true for existing key', async () => {
    await sm.setSecret('K', 'v');
    expect(await sm.hasSecret('K')).toBe(true);
  });

  it('hasSecret returns false for missing key', async () => {
    expect(await sm.hasSecret('NOPE')).toBe(false);
  });

  it('listKeys returns all stored keys', async () => {
    await sm.setSecret('A', '1');
    await sm.setSecret('B', '2');
    const keys = await sm.listKeys();
    expect(keys).toContain('A');
    expect(keys).toContain('B');
    expect(keys).toHaveLength(2);
  });

  it('expired secrets are not returned', async () => {
    const pastDate = new Date(Date.now() - 1000);
    await sm.setSecret('EXPIRED', 'val', pastDate);
    expect(await sm.getSecret('EXPIRED')).toBeUndefined();
  });

  it('non-expired secrets are returned', async () => {
    const futureDate = new Date(Date.now() + 60_000);
    await sm.setSecret('VALID', 'val', futureDate);
    const secret = await sm.getSecret('VALID');
    expect(secret).toBeDefined();
    expect(secret!.value).toBe('val');
  });
});

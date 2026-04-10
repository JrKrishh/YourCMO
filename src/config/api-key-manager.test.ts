import { describe, it, expect, beforeEach } from 'vitest';
import { ApiKeyManager } from './api-key-manager';
import { InMemorySecretsManager } from './secrets-manager';

describe('ApiKeyManager', () => {
  let manager: ApiKeyManager;
  let sm: InMemorySecretsManager;

  beforeEach(() => {
    sm = new InMemorySecretsManager();
    manager = new ApiKeyManager(sm);
  });

  describe('setKey / getKey', () => {
    it('stores and retrieves a key', async () => {
      await manager.setKey('OPENAI_API_KEY', 'sk-abc123');
      const val = await manager.getKey('OPENAI_API_KEY');
      expect(val).toBe('sk-abc123');
    });

    it('returns undefined for missing key', async () => {
      expect(await manager.getKey('NOPE')).toBeUndefined();
    });
  });

  describe('rotateKey', () => {
    it('replaces the key value', async () => {
      await manager.setKey('KEY', 'old-value');
      await manager.rotateKey('KEY', 'new-value');
      expect(await manager.getKey('KEY')).toBe('new-value');
    });

    it('supports setting expiration on rotation', async () => {
      const future = new Date(Date.now() + 60_000);
      await manager.setKey('KEY', 'v1');
      await manager.rotateKey('KEY', 'v2', future);
      expect(await manager.getKey('KEY')).toBe('v2');
    });
  });

  describe('deleteKey', () => {
    it('removes a key', async () => {
      await manager.setKey('KEY', 'val');
      expect(await manager.deleteKey('KEY')).toBe(true);
      expect(await manager.getKey('KEY')).toBeUndefined();
    });

    it('clears usage tracking on delete', async () => {
      await manager.setKey('KEY', 'val');
      await manager.getKey('KEY'); // record usage
      await manager.deleteKey('KEY');
      expect(manager.getUsage('KEY')).toBeUndefined();
    });
  });

  describe('validateKeys', () => {
    it('passes when all required keys are present', async () => {
      manager.registerKey('REQUIRED_KEY', true);
      manager.registerKey('OPTIONAL_KEY', false);
      await manager.setKey('REQUIRED_KEY', 'value');

      const result = await manager.validateKeys();
      expect(result.valid).toBe(true);
      expect(result.present).toContain('REQUIRED_KEY');
      expect(result.missing).toHaveLength(0);
    });

    it('fails when a required key is missing', async () => {
      manager.registerKey('REQUIRED_KEY', true);
      const result = await manager.validateKeys();
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('REQUIRED_KEY');
    });

    it('does not fail for missing optional keys', async () => {
      manager.registerKey('OPTIONAL_KEY', false);
      const result = await manager.validateKeys();
      expect(result.valid).toBe(true);
    });

    it('reports expired keys', async () => {
      manager.registerKey('EXPIRING', true);
      const past = new Date(Date.now() - 1000);
      await manager.setKey('EXPIRING', 'val', past);

      const result = await manager.validateKeys();
      expect(result.valid).toBe(false);
      expect(result.expired).toContain('EXPIRING');
    });

    it('rejects keys that do not match pattern', async () => {
      manager.registerKey('API_KEY', true, /^sk-/);
      await manager.setKey('API_KEY', 'bad-format');

      const result = await manager.validateKeys();
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('API_KEY');
    });

    it('accepts keys matching pattern', async () => {
      manager.registerKey('API_KEY', true, /^sk-/);
      await manager.setKey('API_KEY', 'sk-valid123');

      const result = await manager.validateKeys();
      expect(result.valid).toBe(true);
      expect(result.present).toContain('API_KEY');
    });
  });

  describe('usage tracking', () => {
    it('tracks usage on getKey', async () => {
      await manager.setKey('KEY', 'val');
      await manager.getKey('KEY');
      await manager.getKey('KEY');

      const usage = manager.getUsage('KEY');
      expect(usage).toBeDefined();
      expect(usage!.totalCalls).toBe(2);
      expect(usage!.firstUsedAt).toBeInstanceOf(Date);
      expect(usage!.lastUsedAt).toBeInstanceOf(Date);
    });

    it('does not track usage for missing keys', async () => {
      await manager.getKey('MISSING');
      expect(manager.getUsage('MISSING')).toBeUndefined();
    });

    it('getAllUsage returns all tracked keys', async () => {
      await manager.setKey('A', '1');
      await manager.setKey('B', '2');
      await manager.getKey('A');
      await manager.getKey('B');

      const all = manager.getAllUsage();
      expect(all).toHaveLength(2);
    });
  });

  describe('loadFromRecord', () => {
    it('bulk-loads keys from a record', async () => {
      await manager.loadFromRecord({
        KEY_A: 'val-a',
        KEY_B: 'val-b',
        EMPTY: '',
      });

      expect(await manager.getKey('KEY_A')).toBe('val-a');
      expect(await manager.getKey('KEY_B')).toBe('val-b');
      // Empty values are not stored
      expect(await manager.getKey('EMPTY')).toBeUndefined();
    });
  });

  describe('default secrets manager', () => {
    it('works without providing a secrets manager', async () => {
      const mgr = new ApiKeyManager();
      await mgr.setKey('K', 'v');
      expect(await mgr.getKey('K')).toBe('v');
    });
  });
});

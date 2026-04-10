import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepository } from './in-memory-repository';

interface TestEntity extends Record<string, unknown> {
  id: string;
  name: string;
  value: number;
}

describe('InMemoryRepository', () => {
  let repo: InMemoryRepository<TestEntity>;

  beforeEach(() => {
    repo = new InMemoryRepository<TestEntity>('id');
  });

  describe('create', () => {
    it('should create and return the entity', async () => {
      const entity: TestEntity = { id: '1', name: 'test', value: 42 };
      const result = await repo.create(entity);
      expect(result).toEqual(entity);
    });

    it('should throw if entity with same id already exists', async () => {
      await repo.create({ id: '1', name: 'a', value: 1 });
      await expect(repo.create({ id: '1', name: 'b', value: 2 })).rejects.toThrow(
        "already exists",
      );
    });

    it('should throw if id field is empty', async () => {
      await expect(
        repo.create({ id: '', name: 'a', value: 1 }),
      ).rejects.toThrow('non-empty');
    });

    it('should return a copy, not a reference', async () => {
      const entity: TestEntity = { id: '1', name: 'test', value: 1 };
      const result = await repo.create(entity);
      result.name = 'modified';
      const stored = await repo.findById('1');
      expect(stored!.name).toBe('test');
    });
  });

  describe('findById', () => {
    it('should return the entity if found', async () => {
      await repo.create({ id: '1', name: 'test', value: 10 });
      const result = await repo.findById('1');
      expect(result).toEqual({ id: '1', name: 'test', value: 10 });
    });

    it('should return null if not found', async () => {
      const result = await repo.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all entities', async () => {
      await repo.create({ id: '1', name: 'a', value: 1 });
      await repo.create({ id: '2', name: 'b', value: 2 });
      const results = await repo.findAll();
      expect(results).toHaveLength(2);
    });

    it('should return empty array when store is empty', async () => {
      const results = await repo.findAll();
      expect(results).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update and return the entity', async () => {
      await repo.create({ id: '1', name: 'old', value: 1 });
      const result = await repo.update('1', { name: 'new' });
      expect(result!.name).toBe('new');
      expect(result!.value).toBe(1);
      expect(result!.id).toBe('1');
    });

    it('should return null if entity does not exist', async () => {
      const result = await repo.update('nonexistent', { name: 'x' });
      expect(result).toBeNull();
    });

    it('should not allow overwriting the id field', async () => {
      await repo.create({ id: '1', name: 'test', value: 1 });
      const result = await repo.update('1', { id: 'hacked' } as Partial<TestEntity>);
      expect(result!.id).toBe('1');
    });
  });

  describe('delete', () => {
    it('should delete and return true', async () => {
      await repo.create({ id: '1', name: 'test', value: 1 });
      const result = await repo.delete('1');
      expect(result).toBe(true);
      expect(await repo.findById('1')).toBeNull();
    });

    it('should return false if entity does not exist', async () => {
      const result = await repo.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await repo.create({ id: '1', name: 'alpha', value: 30 });
      await repo.create({ id: '2', name: 'beta', value: 10 });
      await repo.create({ id: '3', name: 'gamma', value: 20 });
    });

    it('should filter by partial match', async () => {
      const results = await repo.query({ filter: { name: 'beta' } });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('2');
    });

    it('should sort ascending', async () => {
      const results = await repo.query({ sortBy: 'value', sortOrder: 'asc' });
      expect(results.map((r) => r.value)).toEqual([10, 20, 30]);
    });

    it('should sort descending', async () => {
      const results = await repo.query({ sortBy: 'value', sortOrder: 'desc' });
      expect(results.map((r) => r.value)).toEqual([30, 20, 10]);
    });

    it('should apply limit', async () => {
      const results = await repo.query({ sortBy: 'value', sortOrder: 'asc', limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('should apply offset', async () => {
      const results = await repo.query({ sortBy: 'value', sortOrder: 'asc', offset: 1 });
      expect(results).toHaveLength(2);
      expect(results[0].value).toBe(20);
    });

    it('should apply limit and offset together', async () => {
      const results = await repo.query({
        sortBy: 'value',
        sortOrder: 'asc',
        offset: 1,
        limit: 1,
      });
      expect(results).toHaveLength(1);
      expect(results[0].value).toBe(20);
    });
  });

  describe('transaction', () => {
    it('should commit changes', async () => {
      await repo.create({ id: '1', name: 'original', value: 1 });
      const tx = repo.beginTransaction();
      await repo.update('1', { name: 'updated' });
      tx.commit();
      const result = await repo.findById('1');
      expect(result!.name).toBe('updated');
    });

    it('should rollback changes', async () => {
      await repo.create({ id: '1', name: 'original', value: 1 });
      const tx = repo.beginTransaction();
      await repo.update('1', { name: 'updated' });
      await repo.create({ id: '2', name: 'new', value: 2 });
      tx.rollback();
      const result = await repo.findById('1');
      expect(result!.name).toBe('original');
      expect(await repo.findById('2')).toBeNull();
    });
  });

  describe('clear and count', () => {
    it('should clear all entities', async () => {
      await repo.create({ id: '1', name: 'a', value: 1 });
      await repo.create({ id: '2', name: 'b', value: 2 });
      await repo.clear();
      expect(await repo.count()).toBe(0);
    });

    it('should return correct count', async () => {
      expect(await repo.count()).toBe(0);
      await repo.create({ id: '1', name: 'a', value: 1 });
      expect(await repo.count()).toBe(1);
    });
  });
});

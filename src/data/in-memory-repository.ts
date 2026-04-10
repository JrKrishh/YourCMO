import { Repository, QueryOptions, Transaction } from './repository';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generic in-memory repository implementation.
 * Uses a Map for O(1) lookups by ID. Supports snapshot-based transactions.
 */
export class InMemoryRepository<T extends Record<string, unknown>> implements Repository<T> {
  protected store: Map<string, T> = new Map();
  private readonly idField: keyof T;
  private snapshot: Map<string, T> | null = null;

  constructor(idField: keyof T) {
    this.idField = idField;
  }

  async create(entity: T): Promise<T> {
    const id = entity[this.idField] as string;
    if (!id) {
      throw new Error(`Entity must have a non-empty '${String(this.idField)}' field`);
    }
    if (this.store.has(id)) {
      throw new Error(`Entity with ${String(this.idField)} '${id}' already exists`);
    }
    this.store.set(id, { ...entity });
    return { ...entity };
  }

  async findById(id: string): Promise<T | null> {
    const entity = this.store.get(id);
    return entity ? { ...entity } : null;
  }

  async findAll(): Promise<T[]> {
    return Array.from(this.store.values()).map((e) => ({ ...e }));
  }

  async update(id: string, partial: Partial<T>): Promise<T | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...partial, [this.idField]: id } as T;
    this.store.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  /**
   * Query with optional filtering, sorting, and pagination.
   */
  async query(options: QueryOptions<T> = {}): Promise<T[]> {
    let results = Array.from(this.store.values());

    // Filter
    if (options.filter) {
      results = results.filter((entity) =>
        Object.entries(options.filter!).every(
          ([key, value]) => entity[key] === value,
        ),
      );
    }

    // Sort
    if (options.sortBy) {
      const key = options.sortBy as string;
      const order = options.sortOrder === 'desc' ? -1 : 1;
      results.sort((a, b) => {
        const aVal = a[key];
        const bVal = b[key];
        if (aVal < bVal) return -1 * order;
        if (aVal > bVal) return 1 * order;
        return 0;
      });
    }

    // Pagination
    const offset = options.offset ?? 0;
    if (options.limit !== undefined) {
      results = results.slice(offset, offset + options.limit);
    } else if (offset > 0) {
      results = results.slice(offset);
    }

    return results.map((e) => ({ ...e }));
  }

  /** Create a snapshot for transaction support. */
  beginTransaction(): Transaction {
    const txId = uuidv4();
    this.snapshot = new Map(
      Array.from(this.store.entries()).map(([k, v]) => [k, { ...v }]),
    );
    return {
      id: txId,
      begin: () => { /* already begun */ },
      commit: () => this.commitTransaction(),
      rollback: () => this.rollbackTransaction(),
    };
  }

  private commitTransaction(): void {
    this.snapshot = null;
  }

  private rollbackTransaction(): void {
    if (this.snapshot) {
      this.store = this.snapshot;
      this.snapshot = null;
    }
  }

  /** Utility: clear all data (useful for tests). */
  async clear(): Promise<void> {
    this.store.clear();
  }

  /** Utility: get current count. */
  async count(): Promise<number> {
    return this.store.size;
  }
}

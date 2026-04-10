/**
 * Generic Repository interface providing CRUD operations for any entity type.
 * Entities must have a string identifier field.
 */
export interface Repository<T> {
  create(entity: T): Promise<T>;
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  update(id: string, entity: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
}

/**
 * Query options for filtering and pagination.
 */
export interface QueryOptions<T> {
  filter?: Partial<T>;
  limit?: number;
  offset?: number;
  sortBy?: keyof T;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Transaction interface for coordinating multi-step operations.
 */
export interface Transaction {
  id: string;
  begin(): void;
  commit(): void;
  rollback(): void;
}

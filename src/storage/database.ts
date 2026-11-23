/**
 * Thin transactional wrapper over a SQL driver. The app uses expo-sqlite; tests use
 * Node's built-in SQLite through the same interface, so the real SQL runs in both.
 *
 * Every operation goes through one serial queue, so a transaction can never interleave
 * with another statement.
 */
export type SqlParam = string | number | null;

export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  all<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
}

export interface Tx {
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  all<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlParam[]): Promise<T | null>;
}

export class Database {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly tx: Tx;

  constructor(private readonly driver: SqlDriver) {
    this.tx = {
      run: (sql, params) => driver.run(sql, params),
      all: (sql, params) => driver.all(sql, params),
      first: async <T>(sql: string, params?: SqlParam[]) => (await driver.all<T>(sql, params))[0] ?? null,
    };
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Runs statements outside a transaction (schema setup, single reads). */
  direct<T>(task: (tx: Tx, exec: (sql: string) => Promise<void>) => Promise<T>): Promise<T> {
    return this.enqueue(() => task(this.tx, (sql) => this.driver.exec(sql)));
  }

  /** Runs the task atomically: every statement commits, or none do. */
  transaction<T>(task: (tx: Tx, exec: (sql: string) => Promise<void>) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.driver.exec('BEGIN IMMEDIATE');
      try {
        const result = await task(this.tx, (sql) => this.driver.exec(sql));
        await this.driver.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          await this.driver.exec('ROLLBACK');
        } catch {
          // The original error is the one worth reporting.
        }
        throw error;
      }
    });
  }
}

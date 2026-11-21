/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite';

import type { SqlDriver, SqlParam } from '../src/storage/database';

const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

/** A real SQLite database in memory. Survives "restarts" as long as the handle is kept. */
export function createMemoryDb(): DatabaseSync {
  return new sqlite.DatabaseSync(':memory:');
}

/** The same driver contract the app uses with expo-sqlite, backed by Node's SQLite. */
export function nodeDriver(db: DatabaseSync): SqlDriver {
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params: SqlParam[] = []) => {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
    all: async <T>(sql: string, params: SqlParam[] = []) => db.prepare(sql).all(...params) as T[],
  };
}

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

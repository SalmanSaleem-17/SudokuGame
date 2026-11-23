import * as SQLite from 'expo-sqlite';

import type { SqlDriver, SqlParam } from './database';

/** The file keeps the game's first name: a new name would start players with an empty database. */
export async function openExpoDriver(name = 'sudoku-studio.db'): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: SqlParam[] = []) => {
      const result = await db.runAsync(sql, params);
      return { changes: result.changes };
    },
    all: <T>(sql: string, params: SqlParam[] = []) => db.getAllAsync<T>(sql, params),
  };
}

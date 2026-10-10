import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export type SqlRow = Record<string, unknown>;

export interface Statement {
  run(...params: unknown[]): void;
  get(...params: unknown[]): SqlRow | undefined;
  all(...params: unknown[]): SqlRow[];
}

export interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

export function openDatabase(filePath: string): Database {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON;');
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  return {
    exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string): Statement {
      const statement = db.prepare(sql);
      return {
        run(...params: unknown[]) {
          statement.run(...params);
        },
        get(...params: unknown[]) {
          const row = statement.get(...params) as SqlRow | undefined;
          return row ? { ...row } : undefined;
        },
        all(...params: unknown[]) {
          return (statement.all(...params) as SqlRow[]).map((row) => ({ ...row }));
        },
      };
    },
    close() {
      db.close();
    },
  };
}

export function transaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

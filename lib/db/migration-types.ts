import type Database from "better-sqlite3";

export interface LegacyMigration {
  id: number;
  key?: undefined;
  name: string;
  up: (db: Database.Database) => void;
}
export interface KeyedMigration {
  key: string;
  id?: undefined;
  name?: undefined;
  up: (db: Database.Database) => void;
}
export type Migration = LegacyMigration | KeyedMigration;

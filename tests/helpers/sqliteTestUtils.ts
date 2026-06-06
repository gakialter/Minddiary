import fs from 'fs'
import os from 'os'
import path from 'path'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'

export type TempDatabase = {
  database: Database.Database
  filepath: string
  root: string
}

export type ForeignKeyViolation = {
  table: string
  rowid: number
  parent: string
  fkid: number
}

export function makeTempRoot(prefix = 'minddiary-sqlite-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function createTempDatabase(filename = 'minddiary.db'): TempDatabase {
  const root = makeTempRoot()
  const filepath = path.join(root, filename)
  return {
    database: new BetterSqlite3(filepath),
    filepath,
    root,
  }
}

export function closeDatabase(database: Database.Database): void {
  try {
    database.close()
  } catch {
    // The code under test may already have closed the handle.
  }
}

export function removeTempRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true })
}

export function getUserVersion(database: Database.Database): number {
  return database.pragma('user_version', { simple: true }) as number
}

export function tableExists(database: Database.Database, tableName: string): boolean {
  const row = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
  return !!row
}

export function indexExists(database: Database.Database, indexName: string): boolean {
  const row = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName)
  return !!row
}

export function getColumnNames(database: Database.Database, tableName: string): string[] {
  return (database.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>)
    .map(column => column.name)
}

export function getPrimaryKeyColumns(database: Database.Database, tableName: string): string[] {
  return (database.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string; pk: number }>)
    .filter(column => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map(column => column.name)
}

export function getTableCount(database: Database.Database, tableName: string): number {
  return (database.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as { count: number }).count
}

export function getIntegrityCheck(database: Database.Database): string {
  return database.pragma('integrity_check', { simple: true }) as string
}

export function getForeignKeyViolations(database: Database.Database): ForeignKeyViolation[] {
  return database.pragma('foreign_key_check') as ForeignKeyViolation[]
}

export function snapshotTableCounts(
  database: Database.Database,
  tableNames: readonly string[],
): Record<string, number> {
  return Object.fromEntries(tableNames.map(tableName => [tableName, getTableCount(database, tableName)]))
}

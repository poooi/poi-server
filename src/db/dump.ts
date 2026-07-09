import crypto from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

import { and, asc, eq, getTableName, gte, inArray, isNotNull, lt } from 'drizzle-orm'

import { getPostgresDb } from './postgres'
import { dataDumpRuns, dumpableAppendHeavyTables } from './schema/postgres'

type DumpableTable = (typeof dumpableAppendHeavyTables)[keyof typeof dumpableAppendHeavyTables]

export interface RunMonthlyDumpOptions {
  outputDir: string
  targetMonth?: string
  referenceDate?: Date
}

export interface MonthlyDumpTableResult {
  tableName: string
  dumpMonth: string
  status: 'dumped' | 'skipped' | 'empty' | 'failed'
  rowCount: number
  checksum?: string
  outputLocation?: string
  error?: string
}

export interface MonthlyDumpRunResult {
  dumpMonth: string
  outputDir: string
  tables: MonthlyDumpTableResult[]
}

const DUMP_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/
const DELETE_BATCH_SIZE = 1_000

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

const getDefaultTargetMonth = (referenceDate: Date): string => {
  const year = referenceDate.getUTCFullYear()
  const month = referenceDate.getUTCMonth()
  const previousMonthDate = new Date(Date.UTC(year, month - 1, 1))
  const previousMonth = previousMonthDate.getUTCMonth() + 1
  return `${previousMonthDate.getUTCFullYear()}-${String(previousMonth).padStart(2, '0')}`
}

const getMonthRange = (dumpMonth: string) => {
  const match = DUMP_MONTH_PATTERN.exec(dumpMonth)
  if (match == null) {
    throw new Error(`Invalid dump month "${dumpMonth}". Expected YYYY-MM.`)
  }

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const start = new Date(Date.UTC(year, monthIndex, 1))
  const end = new Date(Date.UTC(year, monthIndex + 1, 1))
  return { start, end }
}

const toJsonLines = (rows: unknown[]): string =>
  rows.length === 0 ? '' : `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`

const verifyDumpFile = async (
  filePath: string,
): Promise<{ checksum: string; rowCount: number }> => {
  const fileBuffer = await readFile(filePath)
  const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex')
  const fileContents = fileBuffer.toString('utf8')
  const rowCount = fileContents === '' ? 0 : fileContents.trimEnd().split('\n').length
  return { checksum, rowCount }
}

const deleteExportedRows = async (
  databaseUrl: string,
  table: DumpableTable,
  ids: number[],
): Promise<number> => {
  let deletedCount = 0

  for (let index = 0; index < ids.length; index += DELETE_BATCH_SIZE) {
    const batchIds = ids.slice(index, index + DELETE_BATCH_SIZE)
    if (batchIds.length === 0) {
      continue
    }

    const deletedRows = await getPostgresDb(databaseUrl)
      .delete(table)
      .where(inArray(table.id, batchIds))
      .returning({ id: table.id })
    deletedCount += deletedRows.length
  }

  return deletedCount
}

const dumpTableForMonth = async (
  databaseUrl: string,
  table: DumpableTable,
  dumpMonth: string,
  outputDir: string,
): Promise<MonthlyDumpTableResult> => {
  const tableName = getTableName(table)
  const db = getPostgresDb(databaseUrl)

  try {
    const [existingCleanedRun] = await db
      .select({ id: dataDumpRuns.id })
      .from(dataDumpRuns)
      .where(
        and(
          eq(dataDumpRuns.tableName, tableName),
          eq(dataDumpRuns.dumpMonth, dumpMonth),
          isNotNull(dataDumpRuns.cleanedUpAt),
        ),
      )
      .limit(1)

    if (existingCleanedRun != null) {
      return {
        tableName,
        dumpMonth,
        status: 'skipped',
        rowCount: 0,
      }
    }

    const { start, end } = getMonthRange(dumpMonth)
    const rows = await db
      .select()
      .from(table)
      .where(and(gte(table.ingestedAt, start), lt(table.ingestedAt, end)))
      .orderBy(asc(table.id))

    if (rows.length === 0) {
      return {
        tableName,
        dumpMonth,
        status: 'empty',
        rowCount: 0,
      }
    }

    await mkdir(outputDir, { recursive: true })
    const outputLocation = path.resolve(outputDir, `${tableName}_${dumpMonth}.jsonl`)
    await writeFile(outputLocation, toJsonLines(rows), 'utf8')

    const { checksum, rowCount: verifiedRowCount } = await verifyDumpFile(outputLocation)
    if (verifiedRowCount !== rows.length) {
      throw new Error(
        `Dump file verification failed for ${tableName} ${dumpMonth}: expected ${rows.length} rows, found ${verifiedRowCount}`,
      )
    }

    const completedAt = new Date()
    const [dumpRun] = await db
      .insert(dataDumpRuns)
      .values({
        tableName,
        dumpMonth,
        rowCount: rows.length,
        checksum,
        outputLocation,
        completedAt,
      })
      .returning({ id: dataDumpRuns.id })

    if (dumpRun == null) {
      throw new Error(`Unable to record dump metadata for ${tableName} ${dumpMonth}`)
    }

    const deletedCount = await deleteExportedRows(
      databaseUrl,
      table,
      rows.map((row) => row.id),
    )
    if (deletedCount !== rows.length) {
      throw new Error(
        `Cleanup deleted ${deletedCount} rows for ${tableName} ${dumpMonth}, expected ${rows.length}`,
      )
    }

    const cleanedUpAt = new Date()
    await db.update(dataDumpRuns).set({ cleanedUpAt }).where(eq(dataDumpRuns.id, dumpRun.id))

    return {
      tableName,
      dumpMonth,
      status: 'dumped',
      rowCount: rows.length,
      checksum,
      outputLocation,
    }
  } catch (err) {
    return {
      tableName,
      dumpMonth,
      status: 'failed',
      rowCount: 0,
      error: getErrorMessage(err),
    }
  }
}

export const runMonthlyDump = async (
  databaseUrl: string,
  options: RunMonthlyDumpOptions,
): Promise<MonthlyDumpRunResult> => {
  const dumpMonth =
    options.targetMonth ?? getDefaultTargetMonth(options.referenceDate ?? new Date())
  getMonthRange(dumpMonth)

  const tables = await Promise.all(
    Object.values(dumpableAppendHeavyTables).map((table) =>
      dumpTableForMonth(databaseUrl, table, dumpMonth, options.outputDir),
    ),
  )

  return {
    dumpMonth,
    outputDir: path.resolve(options.outputDir),
    tables,
  }
}

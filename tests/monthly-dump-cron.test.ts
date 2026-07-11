import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, test } from 'vitest'

describe('monthly dump cron scripts', () => {
  const installer = readFileSync(path.resolve(__dirname, '../setup-monthly-dump-cron'), 'utf8')
  const runner = readFileSync(path.resolve(__dirname, '../run-monthly-dump-maintenance'), 'utf8')

  test('installs an idempotent managed crontab block without discarding unrelated entries', () => {
    expect(installer).toContain('# BEGIN poi-server monthly dump')
    expect(installer).toContain('# END poi-server monthly dump')
    expect(installer).toContain('!managed { print }')
    expect(installer).toContain('crontab -u "$CRON_USER" "$new_crontab"')
  })

  test('uses JST scheduling, overlap prevention, and persistent logs', () => {
    expect(installer).toContain('CRON_TZ=Asia/Tokyo')
    expect(installer).toContain('./run-monthly-dump-maintenance')
    expect(installer).toContain('>> %s 2>&1')
    expect(runner).toContain('flock -n 9')
    expect(runner).toContain('status=skipped reason=overlap')
    expect(runner).toContain('timeout --foreground "$TIMEOUT"')
  })

  test('runner records start, success, and failure context without shell tracing', () => {
    expect(runner).toContain('status=started')
    expect(runner).toContain('status=succeeded elapsed_seconds=$elapsed_seconds')
    expect(runner).toContain('status=failed exit_code=$exit_code elapsed_seconds=$elapsed_seconds')
    expect(runner).toContain('npm run --silent db:dumps:maintain')
    expect(runner).not.toMatch(/\bset -x\b/)
  })

  test('rejects malformed managed blocks and prepares custom lock directories', () => {
    expect(installer).toContain('existing monthly dump crontab markers are malformed')
    expect(installer).toContain('if [ ! -d "$(dirname "$LOCK_FILE")" ]')
    expect(installer).toContain('POI_DUMP_CRON_TIMEOUT')
  })
})

import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, test } from 'vitest'

describe('monthly dump cron scripts', () => {
  const installer = readFileSync(path.resolve(__dirname, '../setup-monthly-dump-cron.sh'), 'utf8')
  const runner = readFileSync(path.resolve(__dirname, '../run-monthly-dump-maintenance.sh'), 'utf8')

  test('installs an idempotent managed crontab block without discarding unrelated entries', () => {
    expect(installer).toContain('# BEGIN poi-server monthly dump')
    expect(installer).toContain('# END poi-server monthly dump')
    expect(installer).toContain('!managed { print }')
    expect(installer).toContain('crontab -u "$CRON_USER" "$new_crontab"')
  })

  test('uses JST scheduling, overlap prevention, and persistent logs', () => {
    expect(installer).toContain('CRON_TZ=Asia/Tokyo')
    expect(installer).toContain('./run-monthly-dump-maintenance.sh')
    expect(installer).toContain('>> %s 2>&1')
    expect(runner).toContain('flock -n 9')
    expect(runner).toContain('status=skipped reason=overlap')
    expect(runner).toContain('timeout --foreground -- "$TIMEOUT"')
  })

  test('runner records start, success, and failure context without shell tracing', () => {
    expect(runner).toContain('status=started')
    expect(runner).toContain('status=succeeded elapsed_seconds=$elapsed_seconds')
    expect(runner).toContain('status=failed exit_code=$exit_code elapsed_seconds=$elapsed_seconds')
    expect(runner).toContain('npm run --silent db:dumps:maintain')
    expect(runner).toContain('cd -- "$APP_DIR"')
    expect(runner).not.toMatch(/\bset -x\b/)
  })

  test('rejects malformed managed blocks and prepares custom lock directories', () => {
    expect(installer).toContain('existing monthly dump crontab markers are malformed')
    expect(installer).toContain('if [ ! -d "$(dirname "$LOCK_FILE")" ]')
    expect(installer).toContain('POI_DUMP_CRON_TIMEOUT')
  })

  test('requires absolute paths and validates direct runner overrides', () => {
    const absolutePathPattern = String.raw`absolute_path_pattern='^/[A-Za-z0-9_./-]*$'`
    expect(installer).toContain(absolutePathPattern)
    expect(runner).toContain(absolutePathPattern)
    expect(runner).toContain(
      'POI_DUMP_CRON_APP_DIR must be an absolute path with supported characters',
    )
    expect(runner).toContain(
      'POI_DUMP_CRON_LOCK_FILE must be an absolute path with supported characters',
    )
    expect(installer).toContain(
      'POI_DUMP_CRON_LOG_FILE must be an absolute path with supported characters',
    )
    expect(runner).toContain(
      'POI_DUMP_CRON_TIMEOUT must be a positive duration ending in s, m, h, or d',
    )
  })

  test('validates the deployment runtime before installing or running maintenance', () => {
    expect(installer).toContain(
      '[[ -x "$APP_DIR/fnm-exec" ]] || fail "$APP_DIR/fnm-exec is not executable"',
    )
    expect(runner).toContain(
      '[[ -x "$APP_DIR/fnm-exec" ]] || fail "$APP_DIR/fnm-exec is not executable"',
    )
  })

  test('validates the exact GNU and util-linux capabilities used by cron', () => {
    for (const script of [installer, runner]) {
      expect(script).toContain(
        'date --iso-8601=seconds >/dev/null 2>&1 || fail "GNU date with --iso-8601=seconds is required"',
      )
      expect(script).toContain(
        'flock --version >/dev/null 2>&1 || fail "util-linux flock is required"',
      )
      expect(script).toContain('timeout --foreground -- 1s true >/dev/null 2>&1')
      expect(script).toContain('fail "GNU timeout with --foreground is required"')
    }
  })
})

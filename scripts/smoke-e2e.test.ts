import { describe, expect, it } from 'bun:test'
import { commandText, isHealthyStatus, parseSmokeOptions } from './smoke-e2e'

describe('smoke-e2e runner options', () => {
  it('defaults to local smoke without full E2E', () => {
    expect(parseSmokeOptions([], {})).toEqual({
      mode: 'local',
      full: false,
      livePersisted: false,
      baseURL: undefined,
    })
  })

  it('parses separated and inline flags', () => {
    expect(
      parseSmokeOptions(['--mode', 'remote', '--base-url=https://cms.example.test', '--full'], {})
    ).toEqual({
      mode: 'remote',
      full: true,
      livePersisted: false,
      baseURL: 'https://cms.example.test',
    })
  })

  it('enables optional live persisted remote smoke', () => {
    expect(
      parseSmokeOptions(
        ['--mode', 'remote', '--base-url=https://cms.example.test', '--live-persisted'],
        {}
      )
    ).toEqual({
      mode: 'remote',
      full: false,
      livePersisted: true,
      baseURL: 'https://cms.example.test',
    })
  })

  it('parses local-live mode with live persisted flag', () => {
    expect(parseSmokeOptions(['--mode', 'local-live', '--live-persisted'], {})).toEqual({
      mode: 'local-live',
      full: false,
      livePersisted: true,
      baseURL: undefined,
    })
  })

  it('uses BASE_URL env for custom remote smoke', () => {
    expect(parseSmokeOptions(['--mode', 'remote'], { BASE_URL: 'https://preview.example.test' })).toEqual({
      mode: 'remote',
      full: false,
      livePersisted: false,
      baseURL: 'https://preview.example.test',
    })
  })

  it('uses E2E_LIVE_PERSISTED env for remote smoke', () => {
    expect(
      parseSmokeOptions(['--mode', 'remote'], {
        BASE_URL: 'https://preview.example.test',
        E2E_LIVE_PERSISTED: '1',
      })
    ).toEqual({
      mode: 'remote',
      full: false,
      livePersisted: true,
      baseURL: 'https://preview.example.test',
    })
  })

  it('fails fast for remote mode without a base URL', () => {
    expect(() => parseSmokeOptions(['--mode', 'remote'], {})).toThrow(
      'Remote smoke requires --base-url or BASE_URL'
    )
  })

  it('fails fast for unsupported modes', () => {
    expect(() => parseSmokeOptions(['--mode=preview'], {})).toThrow(
      'Unsupported smoke mode: preview'
    )
  })
})

describe('smoke-e2e command and health helpers', () => {
  it('quotes command parts with spaces in compact summaries', () => {
    expect(commandText(['bun', 'run', 'dev', '--var', 'BETTER_AUTH_SECRET:test secret'])).toBe(
      'bun run dev --var "BETTER_AUTH_SECRET:test secret"'
    )
  })

  it('accepts only healthy Worker status values', () => {
    expect(isHealthyStatus('ok')).toBe(true)
    expect(isHealthyStatus('degraded')).toBe(true)
    expect(isHealthyStatus('down')).toBe(false)
    expect(isHealthyStatus(undefined)).toBe(false)
  })
})

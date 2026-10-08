import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { toBrowserDateTime, toRelativeTime } from './date-time'

describe('toBrowserDateTime', () => {
  it('formats a Date object to yyyy-MM-dd HH:mm:ss', () => {
    const date = new Date(2024, 5, 15, 14, 30, 45) // June 15, 2024 14:30:45
    expect(toBrowserDateTime(date)).toBe('2024-06-15 14:30:45')
  })

  it('formats an ISO string to yyyy-MM-dd HH:mm:ss', () => {
    // Use a fixed UTC string and compare with local formatting
    const result = toBrowserDateTime('2024-01-01T00:00:00.000Z')
    // The result depends on local timezone, but format should match
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('formats a numeric timestamp', () => {
    const ts = new Date(2024, 0, 1, 12, 0, 0).getTime()
    expect(toBrowserDateTime(ts)).toBe('2024-01-01 12:00:00')
  })

  it('returns null for an invalid date string', () => {
    expect(toBrowserDateTime('not-a-date')).toBeNull()
  })

  it('returns null for NaN timestamp', () => {
    expect(toBrowserDateTime(Number.NaN)).toBeNull()
  })

  it('handles midnight correctly', () => {
    const date = new Date(2024, 0, 1, 0, 0, 0)
    expect(toBrowserDateTime(date)).toBe('2024-01-01 00:00:00')
  })

  it('handles end of day correctly', () => {
    const date = new Date(2024, 0, 1, 23, 59, 59)
    expect(toBrowserDateTime(date)).toBe('2024-01-01 23:59:59')
  })
})

describe('toRelativeTime', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2024-06-15T12:00:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('returns a relative time string with suffix for past dates', () => {
    const fiveMinutesAgo = new Date('2024-06-15T11:55:00.000Z')
    expect(toRelativeTime(fiveMinutesAgo)).toBe('5 minutes ago')
  })

  it('returns a relative time string for future dates', () => {
    const inTwoHours = new Date('2024-06-15T14:00:00.000Z')
    expect(toRelativeTime(inTwoHours)).toBe('in 2 hours')
  })

  it('returns "-" for an invalid date string', () => {
    expect(toRelativeTime('invalid')).toBe('-')
  })

  it('returns "-" for NaN timestamp', () => {
    expect(toRelativeTime(Number.NaN)).toBe('-')
  })

  it('handles dates from days ago', () => {
    const threeDaysAgo = new Date('2024-06-12T12:00:00.000Z')
    expect(toRelativeTime(threeDaysAgo)).toBe('3 days ago')
  })

  it('accepts a numeric timestamp', () => {
    const oneHourAgo = new Date('2024-06-15T11:00:00.000Z').getTime()
    expect(toRelativeTime(oneHourAgo)).toBe('1 hour ago')
  })

  it('accepts an ISO string', () => {
    expect(toRelativeTime('2024-06-15T11:30:00.000Z')).toBe('30 minutes ago')
  })
})

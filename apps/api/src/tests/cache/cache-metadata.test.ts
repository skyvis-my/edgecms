import { describe, expect, it } from 'bun:test'
import { CacheMetadataTracker } from '../../cache/cache-metadata'

describe('CacheMetadataTracker', () => {
  it('starts with MISS status', () => {
    const tracker = new CacheMetadataTracker()
    expect(tracker.toHeaders()).toMatchObject({
      'X-Cache-Status': 'MISS',
      'X-Cache-Source': 'origin',
      'x-edgecms-cache': 'miss',
    })
  })

  it('records memory hit', () => {
    const tracker = new CacheMetadataTracker()
    tracker.recordHit('memory')
    const headers = tracker.toHeaders()
    expect(headers['X-Cache-Status']).toBe('HIT')
    expect(headers['X-Cache-Source']).toBe('memory')
    expect(headers['x-edgecms-cache']).toBe('hit')
  })

  it('records kv hit', () => {
    const tracker = new CacheMetadataTracker()
    tracker.recordHit('kv')
    const headers = tracker.toHeaders()
    expect(headers['X-Cache-Status']).toBe('HIT')
    expect(headers['X-Cache-Source']).toBe('kv')
    expect(headers['x-edgecms-cache']).toBe('hit')
  })

  it('records stale hit', () => {
    const tracker = new CacheMetadataTracker()
    tracker.recordStale('kv')
    const headers = tracker.toHeaders()
    expect(headers['X-Cache-Status']).toBe('STALE')
    expect(headers['X-Cache-Source']).toBe('kv')
    expect(headers['x-edgecms-cache']).toBe('stale')
  })

  it('includes response time', () => {
    const tracker = new CacheMetadataTracker()
    const headers = tracker.toHeaders()
    expect(headers['X-Response-Time']).toMatch(/^\d+ms$/)
  })
})

/**
 * DL-09: the API Worker declares the outbox sweeper cron and a consumer for
 * each environment's webhook dead-letter queue, and exposes scheduled().
 */
import { describe, expect, it } from 'bun:test'

const toml = await Bun.file(new URL('../../../wrangler.toml', import.meta.url)).text()

describe('wrangler.toml outbox sweeper + DLQ', () => {
  it('declares a cron trigger for the scheduled outbox sweep', () => {
    expect(toml).toMatch(/\[triggers\]\s*\ncrons = \["[^"]+"\]/)
  })

  it('consumes the dead-letter queue in every environment', () => {
    for (const suffix of ['', '-staging', '-production']) {
      const dlq = `edgecms-webhook-dlq${suffix}`
      expect(toml).toContain(`dead_letter_queue = "${dlq}"`)
      expect(toml).toMatch(new RegExp(`\\[\\[(env\\.\\w+\\.)?queues\\.consumers\\]\\]\\s*\\nqueue = "${dlq}"`))
    }
  })
})

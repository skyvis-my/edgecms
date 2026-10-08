import { describe, expect, it } from 'bun:test'
import {
  EntryStatus,
  getAllowedTransitions,
  VALID_TRANSITIONS,
  validateTransition,
} from '../../scheduling/lifecycle.service'

describe('Entry Lifecycle State Machine', () => {
  describe('validateTransition', () => {
    describe('valid transitions', () => {
      it('allows draft → scheduled', () => {
        const result = validateTransition(EntryStatus.DRAFT, EntryStatus.SCHEDULED)
        expect(result).toEqual({ valid: true })
      })

      it('allows draft → published', () => {
        const result = validateTransition(EntryStatus.DRAFT, EntryStatus.PUBLISHED)
        expect(result).toEqual({ valid: true })
      })

      it('allows scheduled → published', () => {
        const result = validateTransition(EntryStatus.SCHEDULED, EntryStatus.PUBLISHED)
        expect(result).toEqual({ valid: true })
      })

      it('allows scheduled → draft', () => {
        const result = validateTransition(EntryStatus.SCHEDULED, EntryStatus.DRAFT)
        expect(result).toEqual({ valid: true })
      })

      it('allows published → archived', () => {
        const result = validateTransition(EntryStatus.PUBLISHED, EntryStatus.ARCHIVED)
        expect(result).toEqual({ valid: true })
      })

      it('allows published → draft', () => {
        const result = validateTransition(EntryStatus.PUBLISHED, EntryStatus.DRAFT)
        expect(result).toEqual({ valid: true })
      })

      it('allows archived → draft', () => {
        const result = validateTransition(EntryStatus.ARCHIVED, EntryStatus.DRAFT)
        expect(result).toEqual({ valid: true })
      })
    })

    describe('invalid transitions', () => {
      it('rejects draft → archived', () => {
        const result = validateTransition(EntryStatus.DRAFT, EntryStatus.ARCHIVED)
        expect(result).toEqual({
          valid: false,
          error: "Cannot transition from 'draft' to 'archived'",
        })
      })

      it('rejects scheduled → archived', () => {
        const result = validateTransition(EntryStatus.SCHEDULED, EntryStatus.ARCHIVED)
        expect(result).toEqual({
          valid: false,
          error: "Cannot transition from 'scheduled' to 'archived'",
        })
      })

      it('rejects published → scheduled', () => {
        const result = validateTransition(EntryStatus.PUBLISHED, EntryStatus.SCHEDULED)
        expect(result).toEqual({
          valid: false,
          error: "Cannot transition from 'published' to 'scheduled'",
        })
      })

      it('rejects archived → scheduled', () => {
        const result = validateTransition(EntryStatus.ARCHIVED, EntryStatus.SCHEDULED)
        expect(result).toEqual({
          valid: false,
          error: "Cannot transition from 'archived' to 'scheduled'",
        })
      })

      it('rejects archived → published', () => {
        const result = validateTransition(EntryStatus.ARCHIVED, EntryStatus.PUBLISHED)
        expect(result).toEqual({
          valid: false,
          error: "Cannot transition from 'archived' to 'published'",
        })
      })

      it('rejects draft → draft (same status)', () => {
        const result = validateTransition(EntryStatus.DRAFT, EntryStatus.DRAFT)
        expect(result).toEqual({
          valid: false,
          error: "Entry is already in 'draft' status",
        })
      })

      it('rejects scheduled → scheduled (same status)', () => {
        const result = validateTransition(EntryStatus.SCHEDULED, EntryStatus.SCHEDULED)
        expect(result).toEqual({
          valid: false,
          error: "Entry is already in 'scheduled' status",
        })
      })
    })

    describe('invalid status values', () => {
      it('rejects invalid current status', () => {
        const result = validateTransition('invalid', EntryStatus.PUBLISHED)
        expect(result).toEqual({
          valid: false,
          error: "Invalid current status: 'invalid'",
        })
      })

      it('rejects invalid target status', () => {
        const result = validateTransition(EntryStatus.DRAFT, 'invalid')
        expect(result).toEqual({
          valid: false,
          error: "Invalid target status: 'invalid'",
        })
      })

      it('rejects both invalid statuses', () => {
        const result = validateTransition('invalid1', 'invalid2')
        expect(result).toEqual({
          valid: false,
          error: "Invalid current status: 'invalid1'",
        })
      })
    })
  })

  describe('getAllowedTransitions', () => {
    it('returns allowed transitions from draft', () => {
      const allowed = getAllowedTransitions(EntryStatus.DRAFT)
      expect(allowed).toEqual([EntryStatus.SCHEDULED, EntryStatus.PUBLISHED])
    })

    it('returns allowed transitions from scheduled', () => {
      const allowed = getAllowedTransitions(EntryStatus.SCHEDULED)
      expect(allowed).toEqual([EntryStatus.PUBLISHED, EntryStatus.DRAFT])
    })

    it('returns allowed transitions from published', () => {
      const allowed = getAllowedTransitions(EntryStatus.PUBLISHED)
      expect(allowed).toEqual([EntryStatus.ARCHIVED, EntryStatus.DRAFT])
    })

    it('returns allowed transitions from archived', () => {
      const allowed = getAllowedTransitions(EntryStatus.ARCHIVED)
      expect(allowed).toEqual([EntryStatus.DRAFT])
    })

    it('returns empty array for invalid status', () => {
      const allowed = getAllowedTransitions('invalid')
      expect(allowed).toEqual([])
    })
  })

  describe('VALID_TRANSITIONS map', () => {
    it('defines transitions for all status values', () => {
      const allStatuses = Object.values(EntryStatus)
      const definedStatuses = Object.keys(VALID_TRANSITIONS)

      expect(definedStatuses).toEqual(allStatuses)
    })

    it('only references valid status values in transitions', () => {
      const allStatuses = Object.values(EntryStatus)

      for (const [_status, transitions] of Object.entries(VALID_TRANSITIONS)) {
        for (const target of transitions) {
          expect(allStatuses).toContain(target)
        }
      }
    })
  })
})

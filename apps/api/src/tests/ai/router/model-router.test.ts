import { describe, expect, it, vi } from 'bun:test'
import type { CommandType } from '@/shared/schemas'

// Mock the provider registry
vi.mock('../../../ai/providers/registry', () => ({
  getModel: vi.fn((tier: string) => {
    return {
      modelId: `mock-model-${tier}`,
      tier,
    }
  }),
}))

const { COMMAND_TIER_MAP, getModelForCommand, getTierForCommand, inferTierForPrompt } =
  await import(`../../../ai/router/model-router?bypass=${Date.now()}`)

describe('Model Router', () => {
  describe('COMMAND_TIER_MAP', () => {
    it('maps nano tier commands correctly', () => {
      const nanoCommands: CommandType[] = [
        'createEntry',
        'updateEntry',
        'deleteEntry',
        'publishNow',
        'unpublishNow',
      ]

      for (const cmd of nanoCommands) {
        expect(COMMAND_TIER_MAP[cmd]).toBe('nano')
      }
    })

    it('maps mid tier commands correctly', () => {
      const midCommands: CommandType[] = [
        'bulkUpdate',
        'linkRelation',
        'unlinkRelation',
        'updateSingleton',
        'schedulePublish',
        'scheduleUnpublish',
        'cancelSchedule',
      ]

      for (const cmd of midCommands) {
        expect(COMMAND_TIER_MAP[cmd]).toBe('mid')
      }
    })

    it('maps heavy tier commands correctly', () => {
      const heavyCommands: CommandType[] = ['transaction']

      for (const cmd of heavyCommands) {
        expect(COMMAND_TIER_MAP[cmd]).toBe('heavy')
      }
    })

    it('includes all command types', () => {
      const allCommandTypes: CommandType[] = [
        'createEntry',
        'updateEntry',
        'deleteEntry',
        'bulkUpdate',
        'updateSingleton',
        'linkRelation',
        'unlinkRelation',
        'publishNow',
        'unpublishNow',
        'schedulePublish',
        'scheduleUnpublish',
        'cancelSchedule',
        'transaction',
      ]

      for (const cmd of allCommandTypes) {
        expect(COMMAND_TIER_MAP[cmd]).toBeDefined()
      }
    })
  })

  describe('getTierForCommand', () => {
    it('returns the correct tier for each command type', () => {
      expect(getTierForCommand('createEntry')).toBe('nano')
      expect(getTierForCommand('bulkUpdate')).toBe('mid')
      expect(getTierForCommand('transaction')).toBe('heavy')
    })

    it('defaults to heavy tier for unknown commands', () => {
      // TypeScript won't allow this without type assertion, but test runtime behavior
      const unknownCommand = 'unknownCommand' as CommandType
      expect(getTierForCommand(unknownCommand)).toBe('heavy')
    })
  })

  describe('getModelForCommand', () => {
    const mockEnv = {
      QWEN_API_KEY: 'test-qwen-key',
      GEMINI_API_KEY: 'test-gemini-key',
    }

    it('delegates to getModel with correct tier for nano commands', () => {
      const model = getModelForCommand('createEntry', mockEnv)
      expect(model).toEqual({
        modelId: 'mock-model-nano',
        tier: 'nano',
      })
    })

    it('delegates to getModel with correct tier for mid commands', () => {
      const model = getModelForCommand('bulkUpdate', mockEnv)
      expect(model).toEqual({
        modelId: 'mock-model-mid',
        tier: 'mid',
      })
    })

    it('delegates to getModel with correct tier for heavy commands', () => {
      const model = getModelForCommand('transaction', mockEnv)
      expect(model).toEqual({
        modelId: 'mock-model-heavy',
        tier: 'heavy',
      })
    })

    it('handles all command types without error', () => {
      const allCommandTypes: CommandType[] = [
        'createEntry',
        'updateEntry',
        'deleteEntry',
        'bulkUpdate',
        'updateSingleton',
        'linkRelation',
        'unlinkRelation',
        'publishNow',
        'unpublishNow',
        'schedulePublish',
        'scheduleUnpublish',
        'cancelSchedule',
        'transaction',
      ]

      for (const cmd of allCommandTypes) {
        expect(() => getModelForCommand(cmd, mockEnv)).not.toThrow()
      }
    })
  })

  describe('Tier allocation strategy', () => {
    it('allocates simple CRUD operations to nano tier', () => {
      const simpleCRUD: CommandType[] = ['createEntry', 'updateEntry', 'deleteEntry']

      for (const cmd of simpleCRUD) {
        expect(getTierForCommand(cmd)).toBe('nano')
      }
    })

    it('allocates simple publishing operations to nano tier', () => {
      const simplePublishing: CommandType[] = ['publishNow', 'unpublishNow']

      for (const cmd of simplePublishing) {
        expect(getTierForCommand(cmd)).toBe('nano')
      }
    })

    it('allocates batch and relation operations to mid tier', () => {
      const moderateComplexity: CommandType[] = [
        'bulkUpdate',
        'linkRelation',
        'unlinkRelation',
        'updateSingleton',
      ]

      for (const cmd of moderateComplexity) {
        expect(getTierForCommand(cmd)).toBe('mid')
      }
    })

    it('allocates complex multi-step operations to heavy tier', () => {
      const complexOperations: CommandType[] = ['transaction']

      for (const cmd of complexOperations) {
        expect(getTierForCommand(cmd)).toBe('heavy')
      }
    })

    it('infers tier from prompt complexity', () => {
      expect(inferTierForPrompt('create a post')).toBe('nano')
      expect(inferTierForPrompt('bulk update entry relations')).toBe('mid')
      expect(inferTierForPrompt('run transaction across collections')).toBe('heavy')
    })
  })
})

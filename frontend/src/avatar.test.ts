import { describe, expect, it } from 'vitest'
import { avatarColors, colorForId, getInitials } from './avatar'
import { fitWithin } from './logo'

describe('getInitials', () => {
  it('uses first and last word, or two letters of a single word', () => {
    expect(getInitials('Droneit Spain SL')).toBe('DS')
    expect(getInitials('acme')).toBe('AC')
    expect(getInitials('  ')).toBe('??')
  })
})

describe('colorForId', () => {
  it('is deterministic and always a known colour', () => {
    expect(colorForId('abc123')).toBe(colorForId('abc123'))
    for (const id of ['', 'a', 'b', 'lq3x9k2zz', 'zzzzzzzzzzzzzzz']) {
      expect(avatarColors).toContain(colorForId(id))
    }
  })

  it('spreads different ids over several colours', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(colorForId))
    expect(colors.size).toBeGreaterThan(3)
  })
})

describe('fitWithin', () => {
  it('keeps aspect ratio and fits the longest side', () => {
    expect(fitWithin(1024, 512, 128)).toEqual({ width: 128, height: 64 })
    expect(fitWithin(300, 600, 128)).toEqual({ width: 64, height: 128 })
  })

  it('never upscales and never returns zero', () => {
    expect(fitWithin(40, 20, 128)).toEqual({ width: 40, height: 20 })
    expect(fitWithin(5000, 1, 128)).toEqual({ width: 128, height: 1 })
  })
})

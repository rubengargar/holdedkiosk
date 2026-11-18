import { describe, expect, it } from 'vitest'
import { avatarColors, colorForId, getInitials } from './avatar'

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

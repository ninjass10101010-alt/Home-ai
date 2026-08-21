import { describe, it, expect } from 'vitest'
import { scoreEvent } from '@/lib/calendar/importance'

describe('scoreEvent', () => {
  it('scores doctor keyword high', () => {
    const event = { title: 'Doctor appointment', start: '', duration: 60, members: [] }
    const { score } = scoreEvent(event)
    expect(score).toBeGreaterThanOrEqual(50)
  })

  it('scores keyword at start with bonus', () => {
    const event = { title: 'Doctor appointment', start: '', duration: 60, members: [] }
    const { score } = scoreEvent(event)
    // +50 keyword +20 at start = 70
    expect(score).toBe(70)
  })

  it('scores keyword not at start without bonus', () => {
    const event = { title: 'My doctor appointment', start: '', duration: 60, members: [] }
    const { score } = scoreEvent(event)
    expect(score).toBe(50)
  })

  it('adds duration bonus for >120', () => {
    const event = { title: 'Doctor check', start: '', duration: 180, members: [] }
    const { score } = scoreEvent(event)
    // 50 +20 start +10 duration = 80
    expect(score).toBe(80)
  })

  it('adds members bonus for multiple members', () => {
    const event = { title: 'Doctor visit', start: '', duration: 60, members: ['Alice', 'Bob'] }
    const { score } = scoreEvent(event)
    // 50+20+10 =80
    expect(score).toBe(80)
  })

  it('caps at 100', () => {
    const event = { title: 'Doctor dentist flight', start: '', duration: 180, members: ['A', 'B'] }
    // 3 keywords *50=150 +20 start +10 duration +10 members =190 capped 100
    const { score } = scoreEvent(event)
    expect(score).toBe(100)
  })

  it('returns 0 for no keyword', () => {
    const event = { title: 'Lunch with friends', start: '', duration: 60, members: [] }
    const { score, reason } = scoreEvent(event)
    expect(score).toBe(0)
    expect(reason).toBe('')
  })

  it('builds reason from matched keywords', () => {
    const event = { title: 'Birthday party', start: '', duration: 60, members: [] }
    const { reason } = scoreEvent(event)
    expect(reason).toContain('birthday')
  })

  it('is case-insensitive', () => {
    const event = { title: 'DOCTOR appointment', start: '', duration: 60, members: [] }
    const { score } = scoreEvent(event)
    expect(score).toBeGreaterThanOrEqual(50)
  })

  it('handles missing title', () => {
    const event: any = { start: '', duration: 60, members: [] }
    const { score } = scoreEvent(event)
    expect(score).toBe(0)
  })

  it('scores all keyword list entries', () => {
    const keywords = ['doctor','dentist','flight','parent teacher','game','tournament','interview','exam','recital','graduation','surgery','vaccine','birthday']
    for (const kw of keywords) {
      const { score } = scoreEvent({ title: kw, start: '', duration: 60, members: [] })
      expect(score).toBeGreaterThanOrEqual(50)
    }
  })
})

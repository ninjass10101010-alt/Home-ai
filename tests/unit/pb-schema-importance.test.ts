import { describe, it, expect } from 'vitest'

// Helper to get events schema from pb-seed COLLECTIONS
import { COLLECTIONS } from '@/lib/pb-seed'

function getPbEventsSchema() {
  const events = COLLECTIONS.find((c) => c.name === 'events')
  if (!events) throw new Error('events collection not found')
  return events
}

describe('pb schema importance fields', () => {
  it('events collection exists', async () => {
    const schema = getPbEventsSchema()
    expect(schema).toBeDefined()
  })

  it('events collection has importanceScore', async () => {
    const schema = getPbEventsSchema()
    const field = (schema.schema as any[]).find((f) => f.name === 'importanceScore')
    expect(field).toBeDefined()
    expect(field.type).toBe('number')
  })

  it('events collection has importanceReason', async () => {
    const schema = getPbEventsSchema()
    const field = (schema.schema as any[]).find((f) => f.name === 'importanceReason')
    expect(field).toBeDefined()
    expect(field.type).toBe('text')
  })

  it('events collection has importanceUpdatedAt', async () => {
    const schema = getPbEventsSchema()
    const field = (schema.schema as any[]).find((f) => f.name === 'importanceUpdatedAt')
    expect(field).toBeDefined()
    expect(field.type).toBe('date')
  })

  it('importanceScore has min 0 and max 100', async () => {
    const schema = getPbEventsSchema()
    const field: any = (schema.schema as any[]).find((f) => f.name === 'importanceScore')
    expect(field).toBeDefined()
    // Options may be stored as `options` or top-level min/max depending on implementation
    const opts = field.options ?? field
    expect(opts.min).toBe(0)
    expect(opts.max).toBe(100)
  })

  it('importance fields are not required', async () => {
    const schema = getPbEventsSchema()
    for (const name of ['importanceScore', 'importanceReason', 'importanceUpdatedAt']) {
      const field: any = (schema.schema as any[]).find((f) => f.name === name)
      expect(field).toBeDefined()
      expect(field.required ?? false).toBe(false)
    }
  })
})

export const KEYWORDS = [
  'doctor',
  'dentist',
  'flight',
  'parent teacher',
  'game',
  'tournament',
  'interview',
  'exam',
  'recital',
  'graduation',
  'surgery',
  'vaccine',
  'birthday',
] as const

export interface ScoreableEvent {
  title?: string | null
  start?: string
  duration?: number
  members?: string[]
}

export function scoreEvent(event: ScoreableEvent): { score: number; reason: string } {
  const title = (event.title || '').toLowerCase()
  let score = 0
  const matched: string[] = []

  for (const kw of KEYWORDS) {
    if (title.includes(kw)) {
      score += 50
      matched.push(kw)
    }
  }

  const firstMatch = KEYWORDS.find((k) => title.includes(k))
  if (firstMatch && title.startsWith(firstMatch)) {
    score += 20
  }

  if ((event.duration ?? 0) > 120) {
    score += 10
  }

  if ((event.members?.length ?? 0) > 1) {
    score += 10
  }

  return {
    score: Math.min(100, score),
    reason: matched.join(', '),
  }
}

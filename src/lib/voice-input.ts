/**
 * Voice Input Processing
 * Converts speech to structured calendar events and tasks
 */

import { createCalendarEvent } from './google/calendar';
import { analyzeMessageAmbiguity, buildClarificationRequest } from './active-clarification';

export interface VoiceInputResult {
  success: boolean;
  transcript: string;
  parsed?: {
    type: 'event' | 'task' | 'reminder' | 'question' | 'unknown';
    details: any;
  };
  clarification?: any;
  error?: string;
}

export interface VoiceProcessingOptions {
  familyMembers?: { name: string; id: string; role: string }[];
  savedLocations?: { name: string; address: string }[];
}

/**
 * Process voice input and convert to structured data
 */
export async function processVoiceInput(
  audioBlob: Blob,
  options: VoiceProcessingOptions = {}
): Promise<VoiceInputResult> {
  try {
    // Step 1: Transcribe audio to text
    const transcript = await transcribeAudio(audioBlob);

    if (!transcript) {
      return {
        success: false,
        transcript: '',
        error: 'Could not transcribe audio',
      };
    }

    // Step 2: Parse the transcript into structured data
    const parsed = parseVoiceTranscript(transcript, options) as { type: 'event' | 'reminder' | 'task' | 'question' | 'unknown'; details: any };

    // Step 3: Check for ambiguity
    if (parsed.type !== 'unknown' && parsed.type !== 'question') {
      const ambiguity = analyzeMessageAmbiguity(transcript, options);

      if (ambiguity.isAmbiguous) {
        const clarification = buildClarificationRequest(transcript, ambiguity);
        return {
          success: true,
          transcript,
          parsed,
          clarification,
        };
      }
    }

    return {
      success: true,
      transcript,
      parsed,
    };
  } catch (error: any) {
    return {
      success: false,
      transcript: '',
      error: error.message,
    };
  }
}

/**
 * Transcribe audio using Web Speech API (browser-based, free)
 * For production, consider OpenAI Whisper API for better accuracy
 */
async function transcribeAudio(audioBlob: Blob): Promise<string> {
  // TODO: Integrate with backend transcription service
  // For now, this is a placeholder that would be called from the client
  // using the Web Speech API

  // In production, this would:
  // 1. Send audio to OpenAI Whisper API
  // 2. Or use server-side transcription
  // 3. Return the transcribed text

  throw new Error('Voice transcription must be implemented client-side using Web Speech API or server-side using Whisper API');
}

/**
 * Parse voice transcript into structured data
 */
function parseVoiceTranscript(
  transcript: string,
  options: VoiceProcessingOptions
): { type: string; details: any } {
  const lower = transcript.toLowerCase();

  // Event creation patterns
  const eventPatterns = [
    {
      pattern: /(?:add|create|schedule|set)\s+(?:an?\s+)?(?:event|meeting|appointment)\s+(?:for\s+)?(.+?)(?:\s+(?:on|at|for)\s+(.+))?$/i,
      type: 'event',
    },
    {
      pattern: /(?:remind|remind me)\s+(?:to\s+)?(.+?)(?:\s+(?:on|at|for)\s+(.+))?$/i,
      type: 'event',
    },
  ];

  // Task creation patterns
  const taskPatterns = [
    {
      pattern: /(?:add|create)\s+(?:a\s+)?task\s+(?:for\s+)?(.+?)(?:\s+(?:for|assigned to)\s+(.+))?$/i,
      type: 'task',
    },
    {
      pattern: /(.+?)\s+(?:is\s+)?(?:a\s+)?(?:task|chore|to[- ]?do)(?:\s+for\s+(.+))?$/i,
      type: 'task',
    },
  ];

  // Reminder patterns
  const reminderPatterns = [
    {
      pattern: /(?:remind|remind me)\s+(?:to\s+)?(.+?)(?:\s+(?:on|at|in)\s+(.+))?$/i,
      type: 'reminder',
    },
  ];

  // Question patterns
  const questionPatterns = [
    {
      pattern: /(?:what|when|where|who|how|why)\s+.+\?/i,
      type: 'question',
    },
  ];

  // Try event patterns
  for (const { pattern, type } of eventPatterns) {
    const match = transcript.match(pattern);
    if (match) {
      return {
        type,
        details: extractEventDetails(match, transcript, options),
      };
    }
  }

  // Try task patterns
  for (const { pattern, type } of taskPatterns) {
    const match = transcript.match(pattern);
    if (match) {
      return {
        type,
        details: extractTaskDetails(match, transcript, options),
      };
    }
  }

  // Try reminder patterns
  for (const { pattern, type } of reminderPatterns) {
    const match = transcript.match(pattern);
    if (match) {
      return {
        type,
        details: extractReminderDetails(match, transcript),
      };
    }
  }

  // Try question patterns
  for (const { pattern, type } of questionPatterns) {
    const match = transcript.match(pattern);
    if (match) {
      return {
        type,
        details: { question: transcript },
      };
    }
  }

  return {
    type: 'unknown',
    details: { text: transcript },
  };
}

/**
 * Extract event details from voice input
 */
function extractEventDetails(
  match: RegExpMatchArray,
  transcript: string,
  options: VoiceProcessingOptions
) {
  const title = match[1]?.trim() || 'New Event';
  const timePhrase = match[2]?.trim() || '';

  // Extract date/time
  const { start, end } = extractDateTime(timePhrase);

  // Extract attendees
  const attendees = extractAttendees(transcript, options.familyMembers || []);

  // Extract location
  const location = extractLocation(transcript, options.savedLocations || []);

  return {
    summary: title,
    start: start.toISOString(),
    end: end.toISOString(),
    location,
    attendees: attendees.map(email => ({ email })),
  };
}

/**
 * Extract task details from voice input
 */
function extractTaskDetails(
  match: RegExpMatchArray,
  transcript: string,
  options: VoiceProcessingOptions
) {
  const title = match[1]?.trim() || 'New Task';
  const assigneePhrase = match[2]?.trim() || '';

  // Extract assignee
  const assignees = extractAttendees(transcript, options.familyMembers || []);

  // Extract due date
  const dueDate = extractDueDate(transcript);

  return {
    title,
    assignees,
    dueDate,
    description: transcript,
  };
}

/**
 * Extract reminder details from voice input
 */
function extractReminderDetails(match: RegExpMatchArray, transcript: string) {
  const title = match[1]?.trim() || 'Reminder';
  const timePhrase = match[2]?.trim() || '';

  const { start, end } = extractDateTime(timePhrase);

  return {
    summary: title,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

/**
 * Extract date and time from natural language
 */
function extractDateTime(phrase: string): { start: Date; end: Date } {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  const lower = phrase.toLowerCase();

  // "tomorrow at 3pm"
  const tomorrowMatch = lower.match(/tomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (tomorrowMatch) {
    start.setDate(start.getDate() + 1);
    let hour = parseInt(tomorrowMatch[1]);
    const minute = tomorrowMatch[2] ? parseInt(tomorrowMatch[2]) : 0;
    const period = tomorrowMatch[3]?.toLowerCase();

    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;

    start.setHours(hour, minute, 0, 0);
    end = new Date(start.getTime() + 60 * 60 * 1000); // Default 1 hour
    return { start, end };
  }

  // "today at 5pm"
  const todayMatch = lower.match(/today\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (todayMatch) {
    let hour = parseInt(todayMatch[1]);
    const minute = todayMatch[2] ? parseInt(todayMatch[2]) : 0;
    const period = todayMatch[3]?.toLowerCase();

    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;

    start.setHours(hour, minute, 0, 0);
    end = new Date(start.getTime() + 60 * 60 * 1000);
    return { start, end };
  }

  // "next monday at 10am"
  const nextDayMatch = lower.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (nextDayMatch) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.indexOf(nextDayMatch[1].toLowerCase());
    const currentDay = start.getDay();
    const daysUntil = (targetDay - currentDay + 7) % 7 || 7;

    start.setDate(start.getDate() + daysUntil);
    let hour = parseInt(nextDayMatch[2]);
    const minute = nextDayMatch[3] ? parseInt(nextDayMatch[3]) : 0;
    const period = nextDayMatch[4]?.toLowerCase();

    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;

    start.setHours(hour, minute, 0, 0);
    end = new Date(start.getTime() + 60 * 60 * 1000);
    return { start, end };
  }

  // Default: tomorrow at current time
  start.setDate(start.getDate() + 1);
  end = new Date(start.getTime() + 60 * 60 * 1000);

  return { start, end };
}

/**
 * Extract due date from natural language
 */
function extractDueDate(phrase: string): Date | undefined {
  const lower = phrase.toLowerCase();

  // "by tomorrow"
  if (lower.includes('by tomorrow')) {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date;
  }

  // "by friday"
  const fridayMatch = lower.match(/by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  if (fridayMatch) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.indexOf(fridayMatch[1].toLowerCase());
    const currentDay = new Date().getDay();
    const daysUntil = (targetDay - currentDay + 7) % 7 || 7;

    const date = new Date();
    date.setDate(date.getDate() + daysUntil);
    return date;
  }

  return undefined;
}

/**
 * Extract attendee names from transcript
 */
function extractAttendees(
  transcript: string,
  familyMembers: { name: string; id: string; role: string }[]
): string[] {
  const attendees: string[] = [];
  const lower = transcript.toLowerCase();

  for (const member of familyMembers) {
    const nameParts = member.name.toLowerCase().split(' ');
    for (const part of nameParts) {
      if (part.length > 2 && lower.includes(part)) {
        // Would need to map name to email in production
        attendees.push(`${part}@family.local`);
        break;
      }
    }
  }

  return attendees;
}

/**
 * Extract location from transcript
 */
function extractLocation(
  transcript: string,
  savedLocations: { name: string; address: string }[]
): string | undefined {
  const lower = transcript.toLowerCase();

  for (const location of savedLocations) {
    if (lower.includes(location.name.toLowerCase())) {
      return location.address;
    }
  }

  return undefined;
}

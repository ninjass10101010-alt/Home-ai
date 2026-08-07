/**
 * Email Forwarding Processor
 * Processes forwarded emails and extracts calendar events, tasks, and reminders
 */

import { analyzeMessageAmbiguity, buildClarificationRequest } from './active-clarification';

export interface EmailForwardingResult {
  success: boolean;
  subject: string;
  body: string;
  parsed?: {
    type: 'event' | 'task' | 'reminder' | 'unknown';
    details: any;
  };
  clarification?: any;
  error?: string;
}

export interface EmailProcessingOptions {
  familyMembers?: { name: string; id: string; role: string }[];
  savedLocations?: { name: string; address: string }[];
  senderDomains?: string[]; // Trusted domains like school, sports leagues
}

/**
 * Process forwarded email and convert to structured data
 */
export async function processEmailForward(
  email: { subject: string; body: string; from: string; date: string },
  options: EmailProcessingOptions = {}
): Promise<EmailForwardingResult> {
  try {
    const { subject, body, from, date } = email;

    // Combine subject and body for analysis
    const fullText = `${subject}\n\n${body}`;

    // Step 1: Parse the email content
    const parsed = parseEmailContent(fullText, options) as { type: 'event' | 'reminder' | 'task' | 'unknown'; details: any };

    // Step 2: Check for ambiguity
    if (parsed.type === 'event' || parsed.type === 'task' || parsed.type === 'reminder') {
      const ambiguity = analyzeMessageAmbiguity(fullText, options);

      if (ambiguity.isAmbiguous) {
        const clarification = buildClarificationRequest(fullText, ambiguity);
        return {
          success: true,
          subject,
          body,
          parsed,
          clarification,
        };
      }
    }

    return {
      success: true,
      subject,
      body,
      parsed,
    };
  } catch (error: any) {
    return {
      success: false,
      subject: email.subject,
      body: email.body,
      error: error.message,
    };
  }
}

/**
 * Parse email content into structured data
 */
function parseEmailContent(
  text: string,
  options: EmailProcessingOptions
): { type: string; details: any } {
  const lower = text.toLowerCase();

  // School newsletter indicators
  const schoolIndicators = [
    'newsletter', 'reminder', 'announcement', 'important',
    'schedule change', 'cancellation', 'postponed', 'rescheduled'
  ];

  // Sports league indicators
  const sportsIndicators = [
    'practice', 'game', 'match', 'tournament', 'schedule',
    'time change', 'location change', 'cancelled'
  ];

  // Medical indicators
  const medicalIndicators = [
    'appointment', 'reminder', 'confirmation', 'upcoming',
    'scheduled', 'reschedule', 'cancel'
  ];

  const hasSchoolContent = schoolIndicators.some(ind => lower.includes(ind));
  const hasSportsContent = sportsIndicators.some(ind => lower.includes(ind));
  const hasMedicalContent = medicalIndicators.some(ind => lower.includes(ind));

  // Extract date/time information
  const { date, time } = extractDateTimeFromEmail(text);
  const hasDateTime = date !== undefined;

  // Determine content type
  if (hasSchoolContent && hasDateTime) {
    return {
      type: 'event',
      details: extractSchoolEvent(text, date, time, options),
    };
  }

  if (hasSportsContent && hasDateTime) {
    return {
      type: 'event',
      details: extractSportsEvent(text, date, time, options),
    };
  }

  if (hasMedicalContent && hasDateTime) {
    return {
      type: 'event',
      details: extractMedicalEvent(text, date, time, options),
    };
  }

  // Task indicators
  const taskIndicators = ['homework', 'assignment', 'project', 'due', 'to-do', 'todo'];
  const hasTaskContent = taskIndicators.some(ind => lower.includes(ind));

  if (hasTaskContent) {
    const dueDate = extractDueDateFromEmail(text);
    return {
      type: 'task',
      details: extractTask(text, dueDate, options),
    };
  }

  return {
    type: 'unknown',
    details: { text },
  };
}

/**
 * Extract school event from email
 */
function extractSchoolEvent(
  text: string,
  date: Date | undefined,
  time: { hour: number; minute: number } | undefined,
  options: EmailProcessingOptions
) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Extract title from subject or first significant line
  const title = lines.find(line =>
    line.length > 5 &&
    line.length < 100 &&
    !line.toLowerCase().includes('date') &&
    !line.toLowerCase().includes('time')
  ) || 'School Event';

  // Extract location
  const location = extractLocation(text, options.savedLocations || []);

  // Extract attendees (students, classes)
  const attendees = extractStudentAttendees(text);

  // Build datetime
  let startIso: string | undefined;
  let endIso: string | undefined;

  if (date) {
    if (time) {
      date.setHours(time.hour, time.minute, 0, 0);
    } else {
      date.setHours(9, 0, 0, 0); // Default to 9am for school events
    }
    startIso = date.toISOString();

    const endDate = new Date(date);
    endDate.setHours(endDate.getHours() + 1); // Default 1 hour
    endIso = endDate.toISOString();
  }

  return {
    summary: title,
    start: startIso,
    end: endIso,
    location,
    description: text,
    attendees,
    source: 'email',
    type: 'school',
  };
}

/**
 * Extract sports event from email
 */
function extractSportsEvent(
  text: string,
  date: Date | undefined,
  time: { hour: number; minute: number } | undefined,
  options: EmailProcessingOptions
) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const title = lines.find(line =>
    line.length > 5 &&
    line.length < 100 &&
    (line.toLowerCase().includes('practice') ||
     line.toLowerCase().includes('game') ||
     line.toLowerCase().includes('match') ||
     line.toLowerCase().includes('tournament'))
  ) || 'Sports Event';

  const location = extractLocation(text, options.savedLocations || []);

  let startIso: string | undefined;
  let endIso: string | undefined;

  if (date) {
    if (time) {
      date.setHours(time.hour, time.minute, 0, 0);
    } else {
      date.setHours(18, 0, 0, 0); // Default to 6pm for sports
    }
    startIso = date.toISOString();

    const endDate = new Date(date);
    endDate.setHours(endDate.getHours() + 2); // Default 2 hours for sports
    endIso = endDate.toISOString();
  }

  return {
    summary: title,
    start: startIso,
    end: endIso,
    location,
    description: text,
    source: 'email',
    type: 'sports',
  };
}

/**
 * Extract medical event from email
 */
function extractMedicalEvent(
  text: string,
  date: Date | undefined,
  time: { hour: number; minute: number } | undefined,
  options: EmailProcessingOptions
) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const title = lines.find(line =>
    line.length > 5 &&
    line.length < 100 &&
    (line.toLowerCase().includes('appointment') ||
     line.toLowerCase().includes('visit') ||
     line.toLowerCase().includes('checkup'))
  ) || 'Medical Appointment';

  const location = extractLocation(text, options.savedLocations || []);

  let startIso: string | undefined;
  let endIso: string | undefined;

  if (date) {
    if (time) {
      date.setHours(time.hour, time.minute, 0, 0);
    } else {
      date.setHours(10, 0, 0, 0); // Default to 10am
    }
    startIso = date.toISOString();

    const endDate = new Date(date);
    endDate.setMinutes(endDate.getMinutes() + 30); // Default 30 min
    endIso = endDate.toISOString();
  }

  return {
    summary: title,
    start: startIso,
    end: endIso,
    location,
    description: text,
    source: 'email',
    type: 'medical',
  };
}

/**
 * Extract task from email
 */
function extractTask(
  text: string,
  dueDate: Date | undefined,
  options: EmailProcessingOptions
) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const title = lines.find(line =>
    line.length > 5 &&
    line.length < 100 &&
    !line.toLowerCase().includes('due') &&
    !line.toLowerCase().includes('assignment')
  ) || 'Task from Email';

  return {
    title,
    description: text,
    dueDate: dueDate?.toISOString(),
    source: 'email',
    type: 'homework',
  };
}

/**
 * Extract date and time from email
 */
function extractDateTimeFromEmail(text: string): {
  date: Date | undefined;
  time: { hour: number; minute: number } | undefined;
} {
  const now = new Date();

  // Date patterns (ordered by specificity)
  const datePatterns = [
    // "Monday, January 15, 2026"
    /(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})/i,
    // "January 15, 2026"
    /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})/i,
    // "1/15/2026" or "01/15/2026"
    /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/,
  ];

  let date: Date | undefined;

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      if (match.length === 5) {
        // "Monday, January 15, 2026"
        const months: Record<string, number> = {
          jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
          apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
          aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
          nov: 10, november: 10, dec: 11, december: 11
        };
        const month = months[match[2].toLowerCase().substring(0, 3)];
        const day = parseInt(match[3]);
        const year = parseInt(match[4]);
        date = new Date(year, month, day);
      } else if (match.length === 4) {
        // "January 15, 2026"
        const months: Record<string, number> = {
          jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
          apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
          aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
          nov: 10, november: 10, dec: 11, december: 11
        };
        const month = months[match[1].toLowerCase().substring(0, 3)];
        const day = parseInt(match[2]);
        const year = parseInt(match[3]);
        date = new Date(year, month, day);
      } else if (match.length === 3) {
        // "1/15/2026"
        const month = parseInt(match[1]) - 1;
        const day = parseInt(match[2]);
        const year = match[3] ? (match[3].length === 2 ? 2000 + parseInt(match[3]) : parseInt(match[3])) : now.getFullYear();
        date = new Date(year, month, day);
      }
      break;
    }
  }

  // Time patterns
  const timePatterns = [
    // "3:30 PM" or "3:30PM"
    /(\d{1,2}):(\d{2})\s*(am|pm)/i,
    // "3 PM" or "3PM"
    /(\d{1,2})\s*(am|pm)/i,
  ];

  let time: { hour: number; minute: number } | undefined;

  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      let hour = parseInt(match[1]);
      const minute = match[2] ? parseInt(match[2]) : 0;
      const period = match[3]?.toLowerCase();

      if (period === 'pm' && hour !== 12) hour += 12;
      if (period === 'am' && hour === 12) hour = 0;

      time = { hour, minute };
      break;
    }
  }

  return { date, time };
}

/**
 * Extract location from email
 */
function extractLocation(
  text: string,
  savedLocations: { name: string; address: string }[]
): string | undefined {
  // Check saved locations first
  for (const location of savedLocations) {
    if (text.toLowerCase().includes(location.name.toLowerCase())) {
      return location.address;
    }
  }

  // Look for location patterns
  const locationPatterns = [
    /(?:at|location:?)\s+(.+?)(?:\n|$|,)/i,
    /(?:venue|place):\s+(.+?)(?:\n|$|,)/i,
  ];

  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return undefined;
}

/**
 * Extract student attendees from email
 */
function extractStudentAttendees(text: string): string[] {
  // Look for student names or class references
  const patterns = [
    /(?:student|child|kid)s?:\s+(.+?)(?:\n|$)/i,
    /(?:class|grade):\s+(.+?)(?:\n|$)/i,
  ];

  const attendees: string[] = [];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      attendees.push(match[1].trim());
    }
  }

  return attendees;
}

/**
 * Extract due date from email
 */
function extractDueDateFromEmail(text: string): Date | undefined {
  const { date } = extractDateTimeFromEmail(text);
  return date;
}

/**
 * Create email forwarding instructions for users
 */
export function getEmailForwardingInstructions(): string {
  return `
# Email Forwarding Setup

Forward emails from school, sports leagues, and other organizations to automatically create calendar events and tasks.

## How to Set Up

1. **Create a forwarding rule** in your email client:
   - Gmail: Settings → Filters and Blocked Addresses → Create new filter
   - Outlook: Rules → Create rule
   - Apple Mail: Rules → Add Rule

2. **Set filter criteria**:
   - From: [school domain], [sports league], etc.
   - Subject contains: "reminder", "schedule", "newsletter", etc.

3. **Forward to**: [your-consuela-email]@family.local

4. **Trusted domains** (examples):
   - School: schoolname.edu, school district domains
   - Sports: league domains, team management
   - Medical: doctor offices, hospitals

## What Gets Extracted

✅ **School Events**: Field trips, parent-teacher conferences, early dismissal
✅ **Sports Events**: Practices, games, tournaments, schedule changes
✅ **Medical Appointments**: Reminders, confirmations, upcoming visits
✅ **Homework**: Assignments, projects, due dates
✅ **Cancellations**: Automatic removal of cancelled events

## Privacy

- Only forwarded emails are processed
- No email content is stored permanently
- Events are created in your family calendar
- You can review and edit before confirming
  `.trim();
}

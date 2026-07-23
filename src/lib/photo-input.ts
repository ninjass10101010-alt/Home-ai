/**
 * Photo Input Processing
 * Converts images (flyers, invitations, etc.) to structured calendar events
 */

import { analyzeMessageAmbiguity, buildClarificationRequest } from './active-clarification';

export interface PhotoInputResult {
  success: boolean;
  text: string;
  parsed?: {
    type: 'event' | 'task' | 'unknown';
    details: any;
  };
  clarification?: any;
  error?: string;
}

export interface PhotoProcessingOptions {
  familyMembers?: { name: string; id: string; role: string }[];
  savedLocations?: { name: string; address: string }[];
}

/**
 * Process photo input and convert to structured data
 */
export async function processPhotoInput(
  imageBlob: Blob,
  options: PhotoProcessingOptions = {}
): Promise<PhotoInputResult> {
  try {
    // Step 1: Extract text from image using OCR
    const text = await extractTextFromImage(imageBlob);

    if (!text || text.trim().length < 10) {
      return {
        success: false,
        text: '',
        error: 'Could not extract readable text from image',
      };
    }

    // Step 2: Parse the extracted text into structured data
    const parsed = parsePhotoText(text, options) as { type: 'event' | 'task' | 'unknown'; details: any };

    // Step 3: Check for ambiguity
    if (parsed.type === 'event') {
      const ambiguity = analyzeMessageAmbiguity(text, options);

      if (ambiguity.isAmbiguous) {
        const clarification = buildClarificationRequest(text, ambiguity);
        return {
          success: true,
          text,
          parsed,
          clarification,
        };
      }
    }

    return {
      success: true,
      text,
      parsed,
    };
  } catch (error: any) {
    return {
      success: false,
      text: '',
      error: error.message,
    };
  }
}

/**
 * Extract text from image using OCR
 *
 * For production, use one of these services:
 * - Google Cloud Vision API (recommended, $1.50/1000 images)
 * - AWS Textract ($1.50/1000 pages)
 * - Azure Computer Vision ($1.50/1000 images)
 * - Tesseract.js (free, client-side, lower accuracy)
 *
 * For now, this is a placeholder that expects the client to use
 * browser-based OCR or send to a backend service
 */
async function extractTextFromImage(imageBlob: Blob): Promise<string> {
  // TODO: Implement OCR service integration
  // This would be called from the client or routed through an API endpoint

  // Example implementation with Google Cloud Vision:
  /*
  const formData = new FormData();
  formData.append('image', imageBlob);

  const response = await fetch('/api/ocr/extract', {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  return result.text;
  */

  throw new Error('OCR must be implemented via /api/ocr/extract endpoint');
}

/**
 * Parse extracted photo text into structured data
 */
function parsePhotoText(
  text: string,
  options: PhotoProcessingOptions
): { type: string; details: any } {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Look for event indicators
  const hasEventIndicators = lines.some(line =>
    line.toLowerCase().includes('event') ||
    line.toLowerCase().includes('meeting') ||
    line.toLowerCase().includes('appointment') ||
    line.toLowerCase().includes('practice') ||
    line.toLowerCase().includes('game') ||
    line.toLowerCase().includes('party') ||
    line.toLowerCase().includes('ceremony')
  );

  // Look for date/time patterns
  const dateTimePatterns = [
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/i,
    /\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i,
    /\b\d{1,2}\s*(?:am|pm)\b/i,
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/, // MM/DD or MM/DD/YYYY
  ];

  const hasDateTime = dateTimePatterns.some(pattern => pattern.test(text));

  if (hasEventIndicators && hasDateTime) {
    return {
      type: 'event',
      details: extractEventFromPhoto(lines, text, options),
    };
  }

  // Look for task indicators
  const hasTaskIndicators = lines.some(line =>
    line.toLowerCase().includes('to-do') ||
    line.toLowerCase().includes('todo') ||
    line.toLowerCase().includes('task') ||
    line.toLowerCase().includes('homework') ||
    line.toLowerCase().includes('assignment')
  );

  if (hasTaskIndicators) {
    return {
      type: 'task',
      details: extractTaskFromPhoto(lines, text, options),
    };
  }

  return {
    type: 'unknown',
    details: { text },
  };
}

/**
 * Extract event details from photo text
 */
function extractEventFromPhoto(
  lines: string[],
  fullText: string,
  options: PhotoProcessingOptions
) {
  // Try to extract title (usually the first significant line)
  const title = lines.find(line =>
    line.length > 3 &&
    line.length < 100 &&
    !line.match(/^\d/) && // Not starting with a number
    !line.includes(':') && // Not a time
    !line.toLowerCase().includes('date') &&
    !line.toLowerCase().includes('time') &&
    !line.toLowerCase().includes('location')
  ) || 'Event from Photo';

  // Extract date and time
  const { date, time } = extractDateAndTime(fullText);

  // Extract location
  const location = extractLocationFromText(fullText, options.savedLocations || []);

  // Extract organizer or contact
  const organizer = extractOrganizer(lines);

  return {
    summary: title,
    start: date,
    end: date ? addDuration(date, time) : undefined,
    location,
    description: fullText,
    organizer,
  };
}

/**
 * Extract task details from photo text
 */
function extractTaskFromPhoto(
  lines: string[],
  fullText: string,
  options: PhotoProcessingOptions
) {
  // Try to extract task title
  const title = lines.find(line =>
    line.length > 3 &&
    line.length < 100 &&
    !line.toLowerCase().includes('to-do') &&
    !line.toLowerCase().includes('task')
  ) || 'Task from Photo';

  // Extract due date
  const dueDate = extractDueDateFromText(fullText);

  return {
    title,
    description: fullText,
    dueDate,
  };
}

/**
 * Extract date and time from text
 */
function extractDateAndTime(text: string): { date: string | undefined; time: string | undefined } {
  const now = new Date();

  // Look for explicit date
  const datePatterns = [
    // "Monday, January 15, 2026"
    {
      pattern: /(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})/i,
      handler: (match: RegExpMatchArray) => {
        const months: Record<string, number> = {
          jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
          apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
          aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
          nov: 10, november: 10, dec: 11, december: 11
        };
        const month = months[match[2].toLowerCase().substring(0, 3)];
        const day = parseInt(match[3]);
        const year = parseInt(match[4]);
        return new Date(year, month, day);
      },
    },
    // "January 15, 2026"
    {
      pattern: /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})/i,
      handler: (match: RegExpMatchArray) => {
        const months: Record<string, number> = {
          jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
          apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
          aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
          nov: 10, november: 10, dec: 11, december: 11
        };
        const month = months[match[1].toLowerCase().substring(0, 3)];
        const day = parseInt(match[2]);
        const year = parseInt(match[3]);
        return new Date(year, month, day);
      },
    },
    // "1/15/2026" or "01/15/2026"
    {
      pattern: /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/,
      handler: (match: RegExpMatchArray) => {
        const month = parseInt(match[1]) - 1;
        const day = parseInt(match[2]);
        const year = match[3] ? (match[3].length === 2 ? 2000 + parseInt(match[3]) : parseInt(match[3])) : now.getFullYear();
        return new Date(year, month, day);
      },
    },
  ];

  let date: Date | undefined;
  for (const { pattern, handler } of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      date = handler(match);
      break;
    }
  }

  // Look for time
  const timePatterns = [
    // "3:30 PM" or "3:30PM"
    {
      pattern: /(\d{1,2}):(\d{2})\s*(am|pm)/i,
      handler: (match: RegExpMatchArray) => {
        let hour = parseInt(match[1]);
        const minute = parseInt(match[2]);
        const period = match[3].toLowerCase();

        if (period === 'pm' && hour !== 12) hour += 12;
        if (period === 'am' && hour === 12) hour = 0;

        return { hour, minute };
      },
    },
    // "3 PM" or "3PM"
    {
      pattern: /(\d{1,2})\s*(am|pm)/i,
      handler: (match: RegExpMatchArray) => {
        let hour = parseInt(match[1]);
        const period = match[2].toLowerCase();

        if (period === 'pm' && hour !== 12) hour += 12;
        if (period === 'am' && hour === 12) hour = 0;

        return { hour, minute: 0 };
      },
    },
  ];

  let time: { hour: number; minute: number } | undefined;
  for (const { pattern, handler } of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      time = handler(match);
      break;
    }
  }

  // Combine date and time
  if (date && time) {
    date.setHours(time.hour, time.minute, 0, 0);
    return {
      date: date.toISOString(),
      time: `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`,
    };
  }

  if (date) {
    return { date: date.toISOString(), time: undefined };
  }

  return { date: undefined, time: undefined };
}

/**
 * Add duration to a date (default 1 hour)
 */
function addDuration(dateStr: string, time?: string): string {
  const date = new Date(dateStr);
  date.setHours(date.getHours() + 1); // Default 1 hour duration
  return date.toISOString();
}

/**
 * Extract location from text
 */
function extractLocationFromText(
  text: string,
  savedLocations: { name: string; address: string }[]
): string | undefined {
  // Check saved locations first
  for (const location of savedLocations) {
    if (text.toLowerCase().includes(location.name.toLowerCase())) {
      return location.address;
    }
  }

  // Look for "at [location]" or "location: [location]"
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
 * Extract organizer from text
 */
function extractOrganizer(lines: string[]): string | undefined {
  const organizerPatterns = [
    /(?:organized by|hosted by|contact):\s+(.+?)(?:\n|$)/i,
    /(?:organizer|host):\s+(.+?)(?:\n|$)/i,
  ];

  for (const line of lines) {
    for (const pattern of organizerPatterns) {
      const match = line.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
  }

  return undefined;
}

/**
 * Extract due date from text
 */
function extractDueDateFromText(text: string): string | undefined {
  const { date } = extractDateAndTime(text);
  return date;
}

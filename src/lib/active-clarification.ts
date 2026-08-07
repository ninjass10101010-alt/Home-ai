/**
 * Active Clarification System
 * Detects ambiguous instructions and asks for confirmation before executing
 */

export interface ClarificationRequest {
  id: string;
  message: string;
  options: ClarificationOption[];
  context: any;
  confidence: number;
}

export interface ClarificationOption {
  id: string;
  label: string;
  description?: string;
  value: any;
  isDefault?: boolean;
}

export interface AmbiguityDetection {
  isAmbiguous: boolean;
  type: 'name' | 'time' | 'location' | 'action' | 'recurrence' | 'multiple';
  details: string;
  suggestions: string[];
}

/**
 * Detect if a message contains ambiguous references to people
 */
export function detectNameAmbiguity(
  message: string,
  familyMembers: { name: string; id: string; role: string }[]
): AmbiguityDetection {
  const names = familyMembers.map(m => m.name.toLowerCase());
  const foundNames: string[] = [];

  // Check for partial name matches
  for (const member of familyMembers) {
    const nameParts = member.name.toLowerCase().split(' ');
    for (const part of nameParts) {
      if (message.toLowerCase().includes(part) && part.length > 2) {
        foundNames.push(member.name);
        break;
      }
    }
  }

  if (foundNames.length > 1) {
    return {
      isAmbiguous: true,
      type: 'name',
      details: `Found multiple people: ${foundNames.join(', ')}`,
      suggestions: foundNames.map(name => `Did you mean ${name}?`),
    };
  }

  return {
    isAmbiguous: false,
    type: 'name',
    details: '',
    suggestions: [],
  };
}

/**
 * Detect if a time reference is ambiguous
 */
export function detectTimeAmbiguity(message: string): AmbiguityDetection {
  const ambiguousPatterns = [
    { pattern: /\btomorrow\b/i, ambiguity: 'Tomorrow morning or evening?' },
    { pattern: /\bnext week\b/i, ambiguity: 'Which day next week?' },
    { pattern: /\bthis weekend\b/i, ambiguity: 'Saturday or Sunday?' },
    { pattern: /\btonight\b/i, ambiguity: 'What time tonight?' },
    { pattern: /\bsoon\b/i, ambiguity: 'How soon? (e.g., in an hour, tomorrow, next week)' },
    { pattern: /\blater\b/i, ambiguity: 'When later? (e.g., this afternoon, tomorrow)' },
  ];

  for (const { pattern, ambiguity } of ambiguousPatterns) {
    if (pattern.test(message)) {
      return {
        isAmbiguous: true,
        type: 'time',
        details: ambiguity,
        suggestions: [
          'Please specify a more precise time',
          'Example: tomorrow at 3pm, next Tuesday morning',
        ],
      };
    }
  }

  // Check for missing time in event creation
  const eventKeywords = ['meeting', 'appointment', 'event', 'schedule', 'add'];
  const hasEventKeyword = eventKeywords.some(kw => message.toLowerCase().includes(kw));
  const hasTime = /\b(\d{1,2}(:\d{2})?\s*(am|pm)?)\b/i.test(message) ||
                  /\b(morning|afternoon|evening|night)\b/i.test(message);

  if (hasEventKeyword && !hasTime) {
    return {
      isAmbiguous: true,
      type: 'time',
      details: 'What time would you like to schedule this?',
      suggestions: [
        'Add a specific time (e.g., at 3pm)',
        'Add a date and time (e.g., tomorrow at 10am)',
      ],
    };
  }

  return {
    isAmbiguous: false,
    type: 'time',
    details: '',
    suggestions: [],
  };
}

/**
 * Detect if a location reference is ambiguous
 */
export function detectLocationAmbiguity(
  message: string,
  savedLocations: { name: string; address: string }[]
): AmbiguityDetection {
  const locationKeywords = ['at', 'in', 'meeting at', 'dinner at', 'lunch at'];
  const hasLocationKeyword = locationKeywords.some(kw =>
    message.toLowerCase().includes(kw)
  );

  if (hasLocationKeyword) {
    // Check if a location name is provided
    const locationMatch = message.match(/(?:at|in)\s+([A-Za-z\s]+)/i);
    if (locationMatch) {
      const location = locationMatch[1].trim();
      const matches = savedLocations.filter(l =>
        l.name.toLowerCase().includes(location.toLowerCase()) ||
        l.address.toLowerCase().includes(location.toLowerCase())
      );

      if (matches.length > 1) {
        return {
          isAmbiguous: true,
          type: 'location',
          details: `Found multiple locations matching "${location}"`,
          suggestions: matches.map(m => m.name),
        };
      }
    }
  }

  return {
    isAmbiguous: false,
    type: 'location',
    details: '',
    suggestions: [],
  };
}

/**
 * Detect if the action is ambiguous
 */
export function detectActionAmbiguity(message: string): AmbiguityDetection {
  const ambiguousActions = [
    { pattern: /\b(set|create|make)\b.*\b(reminder|task|event)\b/i, actions: ['reminder', 'task', 'calendar event'] },
    { pattern: /\bschedule\b/i, actions: ['meeting', 'appointment', 'event'] },
  ];

  for (const { pattern, actions } of ambiguousActions) {
    if (pattern.test(message)) {
      return {
        isAmbiguous: true,
        type: 'action',
        details: `What type of ${actions.join('/')} would you like to create?`,
        suggestions: actions,
      };
    }
  }

  return {
    isAmbiguous: false,
    type: 'action',
    details: '',
    suggestions: [],
  };
}

/**
 * Detect if recurrence is ambiguous
 */
export function detectRecurrenceAmbiguity(message: string): AmbiguityDetection {
  const recurrenceKeywords = ['every', 'weekly', 'monthly', 'daily', 'regularly'];
  const hasRecurrenceKeyword = recurrenceKeywords.some(kw =>
    message.toLowerCase().includes(kw)
  );

  if (hasRecurrenceKeyword) {
    const patterns = [
      { pattern: /\bevery\s+week\b/i, details: 'Every week - which day(s)?', suggestions: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
      { pattern: /\bweekly\b/i, details: 'Weekly - which day and time?', suggestions: ['Every Monday at 9am', 'Every Friday at 5pm'] },
      { pattern: /\bmonthly\b/i, details: 'Monthly - which day?', suggestions: ['First Monday of the month', 'Last Friday of the month', 'Every 15th'] },
    ];

    for (const { pattern, details, suggestions } of patterns) {
      if (pattern.test(message)) {
        return {
          isAmbiguous: true,
          type: 'recurrence',
          details,
          suggestions,
        };
      }
    }
  }

  return {
    isAmbiguous: false,
    type: 'recurrence',
    details: '',
    suggestions: [],
  };
}

/**
 * Run all ambiguity detections on a message
 */
export function analyzeMessageAmbiguity(
  message: string,
  context: {
    familyMembers?: { name: string; id: string; role: string }[];
    savedLocations?: { name: string; address: string }[];
  }
): {
  isAmbiguous: boolean;
  clarifications: AmbiguityDetection[];
  confidence: number;
} {
  const clarifications: AmbiguityDetection[] = [];

  if (context.familyMembers) {
    const nameAmbiguity = detectNameAmbiguity(message, context.familyMembers);
    if (nameAmbiguity.isAmbiguous) clarifications.push(nameAmbiguity);
  }

  const timeAmbiguity = detectTimeAmbiguity(message);
  if (timeAmbiguity.isAmbiguous) clarifications.push(timeAmbiguity);

  if (context.savedLocations) {
    const locationAmbiguity = detectLocationAmbiguity(message, context.savedLocations);
    if (locationAmbiguity.isAmbiguous) clarifications.push(locationAmbiguity);
  }

  const actionAmbiguity = detectActionAmbiguity(message);
  if (actionAmbiguity.isAmbiguous) clarifications.push(actionAmbiguity);

  const recurrenceAmbiguity = detectRecurrenceAmbiguity(message);
  if (recurrenceAmbiguity.isAmbiguous) clarifications.push(recurrenceAmbiguity);

  // Calculate confidence (lower = more ambiguous)
  const confidence = clarifications.length === 0 ? 1.0 : Math.max(0.3, 1.0 - clarifications.length * 0.2);

  return {
    isAmbiguous: clarifications.length > 0,
    clarifications,
    confidence,
  };
}

/**
 * Build a clarification request from ambiguities
 */
export function buildClarificationRequest(
  message: string,
  ambiguities: ReturnType<typeof analyzeMessageAmbiguity>
): ClarificationRequest | null {
  if (!ambiguities.isAmbiguous) return null;

  const options: ClarificationOption[] = [];

  for (const amb of ambiguities.clarifications) {
    for (const suggestion of amb.suggestions) {
      options.push({
        id: `${amb.type}-${suggestion}`,
        label: suggestion,
        description: amb.details,
        value: { type: amb.type, suggestion },
      });
    }
  }

  // Add a "Let me rephrase" option
  options.push({
    id: 'rephrase',
    label: '✏️ Let me rephrase',
    description: 'I\'ll try again with more details',
    value: { type: 'rephrase' },
    isDefault: true,
  });

  return {
    id: `clarify-${Date.now()}`,
    message: 'I need a bit more information to help you with that.',
    options,
    context: {
      originalMessage: message,
      ambiguities: ambiguities.clarifications,
    },
    confidence: ambiguities.confidence,
  };
}

/**
 * Format clarification request for display
 */
export function formatClarificationForDisplay(request: ClarificationRequest): string {
  let text = `💭 ${request.message}\n\n`;

  const groupedByType: Record<string, ClarificationOption[]> = {};
  for (const option of request.options) {
    const type = option.value.type;
    if (!groupedByType[type]) groupedByType[type] = [];
    groupedByType[type].push(option);
  }

  for (const [type, opts] of Object.entries(groupedByType)) {
    const typeLabels: Record<string, string> = {
      name: '👤 Who?',
      time: '🕐 When?',
      location: '📍 Where?',
      action: '🎯 What?',
      recurrence: '🔄 How often?',
      rephrase: '✏️ Other',
    };

    text += `${typeLabels[type] || type}:\n`;
    for (const opt of opts) {
      text += `  • ${opt.label}\n`;
    }
    text += '\n';
  }

  return text;
}

/**
 * Enhanced Hermes Tools with Nori-inspired features
 * Adds conflict detection, buffer scheduling, and clarification tools
 */

import type { Tool } from './hermes-tools';
import { wouldConflict } from './conflict-detection';
import { suggestBuffers, createBufferEvents } from './auto-buffer-scheduling';
import { analyzeMessageAmbiguity, buildClarificationRequest } from './active-clarification';
import { getPB } from './pb';

/**
 * Tool: Check for scheduling conflicts before creating an event
 */
export const checkConflictsTool: Tool = {
  definition: {
    name: 'check_conflicts',
    description: 'Check if creating an event would cause scheduling conflicts. Use this BEFORE creating any event to detect overlaps, travel time issues, or double-bookings.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title/summary' },
        start: { type: 'string', description: 'Event start time (ISO 8601 format)' },
        end: { type: 'string', description: 'Event end time (ISO 8601 format)' },
        location: { type: 'string', description: 'Event location (optional)' },
        attendees: { type: 'array', description: 'List of attendee emails (optional)' },
      },
      required: ['summary', 'start', 'end'],
    },
  },
  handler: async (args: any) => {
    try {
      const result = await wouldConflict({
        newEvent: {
          summary: args.summary,
          start: args.start,
          end: args.end,
          location: args.location,
          attendees: args.attendees,
        },
        travelTimeMinutes: 15,
      });

      return JSON.stringify({
        hasConflict: result.hasConflict,
        conflictCount: result.conflicts.length,
        summary: result.summary,
        conflicts: result.conflicts.map(c => ({
          type: c.type,
          severity: c.severity,
          message: c.message,
          suggestion: c.suggestion,
          resolution: c.resolution,
        })),
      });
    } catch (error: any) {
      return JSON.stringify({ error: error.message });
    }
  },
};

/**
 * Tool: Suggest buffer times for an event
 */
export const suggestBuffersTool: Tool = {
  definition: {
    name: 'suggest_buffers',
    description: 'Suggest buffer times and travel time for an event. Use this after checking for conflicts to add preparation and travel time.',
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'Event start time (ISO 8601 format)' },
        end: { type: 'string', description: 'Event end time (ISO 8601 format)' },
        location: { type: 'string', description: 'Event location (optional, for travel time calculation)' },
      },
      required: ['start', 'end'],
    },
  },
  handler: async (args: any) => {
    try {
      const { buffers, totalBufferTime } = await suggestBuffers({
        start: args.start,
        end: args.end,
        location: args.location,
      });

      return JSON.stringify({
        bufferCount: buffers.length,
        totalBufferTime,
        buffers: buffers.map(b => ({
          type: b.type,
          start: b.start,
          end: b.end,
          duration: b.duration,
          description: b.description,
        })),
        message: buffers.length > 0
          ? `I found ${buffers.length} buffer${buffers.length > 1 ? 's' : ''} (${totalBufferTime} min total) to add travel and preparation time.`
          : 'No additional buffers needed - your schedule looks clear!',
      });
    } catch (error: any) {
      return JSON.stringify({ error: error.message });
    }
  },
};

/**
 * Tool: Create buffer events in Google Calendar
 */
export const createBuffersTool: Tool = {
  definition: {
    name: 'create_buffers',
    description: 'Create buffer events (travel time, preparation time) in Google Calendar. Use this after suggesting buffers and getting user approval.',
    parameters: {
      type: 'object',
      properties: {
        buffers: { type: 'array', description: 'Array of buffer objects with start, end, description' },
        mainEventSummary: { type: 'string', description: 'Summary of the main event these buffers are for' },
      },
      required: ['buffers', 'mainEventSummary'],
    },
  },
  handler: async (args: any) => {
    try {
      const { created, errors } = await createBufferEvents(
        args.buffers,
        args.mainEventSummary
      );

      return JSON.stringify({
        created,
        errors,
        message: created > 0
          ? `✅ Created ${created} buffer event${created > 1 ? 's' : ''} in your calendar!`
          : errors > 0
            ? `⚠️ Failed to create some buffers (${errors} error${errors > 1 ? 's' : ''})`
            : 'No buffers to create',
      });
    } catch (error: any) {
      return JSON.stringify({ error: error.message });
    }
  },
};

/**
 * Tool: Check for ambiguity in user message
 */
export const checkAmbiguityTool: Tool = {
  definition: {
    name: 'check_ambiguity',
    description: 'Check if the user message is ambiguous and needs clarification. Use this when the user asks to create an event or task but details are unclear.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The user message to analyze' },
      },
      required: ['message'],
    },
  },
  handler: async (args: any) => {
    try {
      const pb = getPB();

      // Get family context
      const familyMembers = await pb.collection('consuela_family_members').getFullList({
        requestKey: null,
      });

      const savedLocations = await pb.collection('consuela_saved_locations').getFullList({
        requestKey: null,
      });

      const ambiguity = analyzeMessageAmbiguity(args.message, {
        familyMembers: familyMembers.map((m: any) => ({
          name: m.name,
          id: m.id,
          role: m.role,
        })),
        savedLocations: savedLocations.map((l: any) => ({
          name: l.name,
          address: l.address,
        })),
      });

      if (ambiguity.isAmbiguous) {
        const clarification = buildClarificationRequest(args.message, ambiguity);

        return JSON.stringify({
          isAmbiguous: true,
          confidence: ambiguity.confidence,
          clarifications: ambiguity.clarifications.map(c => ({
            type: c.type,
            details: c.details,
            suggestions: c.suggestions,
          })),
          clarification: clarification
            ? {
                message: clarification.message,
                options: clarification.options.slice(0, 5), // Limit to top 5 options
              }
            : null,
          message: `I need more information to help you. ${ambiguity.clarifications[0]?.details || ''}`,
        });
      }

      return JSON.stringify({
        isAmbiguous: false,
        confidence: ambiguity.confidence,
        message: 'Message is clear - no clarification needed',
      });
    } catch (error: any) {
      return JSON.stringify({ error: error.message });
    }
  },
};

/**
 * Export all enhanced tools
 */
export const enhancedTools: Tool[] = [
  checkConflictsTool,
  suggestBuffersTool,
  createBuffersTool,
  checkAmbiguityTool,
];

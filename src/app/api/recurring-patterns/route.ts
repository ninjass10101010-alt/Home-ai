/**
 * GET /api/recurring-patterns
 * Get recurring patterns for a family
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  detectRecurringPatterns,
  getFamilyPatterns,
  suggestPatterns,
} from '@/lib/recurring-patterns';
import { getPB } from '@/lib/pb';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const familyId = searchParams.get('familyId') || 'demo-family';
    const type = searchParams.get('type') || 'list';

    if (type === 'detect') {
      // Detect patterns from past events
      const lookbackDays = parseInt(searchParams.get('lookback') || '90');
      const result = await detectRecurringPatterns(familyId, lookbackDays);

      // Store detected patterns
      for (const pattern of result.patterns) {
        await (await import('@/lib/recurring-patterns')).storePattern(pattern);
      }

      return NextResponse.json({
        success: true,
        result,
      });
    }

    if (type === 'suggest') {
      // Suggest patterns from recent events
      const pb = getPB();
      const recentEvents = await pb.collection('consuela_events').getFullList({
        filter: `familyId = "${familyId}"`,
        sort: '-date',
        requestKey: null,
      });

      const suggestions = await suggestPatterns(familyId, recentEvents.slice(0, 50));

      return NextResponse.json({
        success: true,
        suggestions,
      });
    }

    if (type === 'list') {
      // Get all stored patterns
      const patterns = await getFamilyPatterns(familyId);

      return NextResponse.json({
        success: true,
        patterns,
        count: patterns.length,
      });
    }

    return NextResponse.json(
      { error: 'Invalid type. Must be "detect", "suggest", or "list"' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Failed to get recurring patterns:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get patterns' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/recurring-patterns
 * Enable or disable auto-scheduling for a pattern
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { patternId, action } = body;

    if (!patternId) {
      return NextResponse.json(
        { error: 'patternId is required' },
        { status: 400 }
      );
    }

    if (action === 'enable') {
      const success = await (await import('@/lib/recurring-patterns')).enableAutoSchedule(patternId);
      
      if (!success) {
        return NextResponse.json(
          { error: 'Failed to enable auto-schedule' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'Auto-scheduling enabled',
      });
    }

    if (action === 'disable') {
      const success = await (await import('@/lib/recurring-patterns')).disableAutoSchedule(patternId);
      
      if (!success) {
        return NextResponse.json(
          { error: 'Failed to disable auto-schedule' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'Auto-scheduling disabled',
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Must be "enable" or "disable"' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Failed to update pattern:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update pattern' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/schedule-analytics
 * Get schedule analytics for a date range
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  calculateScheduleAnalytics,
  getTaskCompletionStats,
  getTimeSpentAnalytics,
} from '@/lib/schedule-analytics';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const familyId = searchParams.get('familyId') || 'demo-family';
    const type = searchParams.get('type') || 'schedule';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const period = searchParams.get('period') || 'month';

    if (type === 'schedule') {
      if (!startDate || !endDate) {
        return NextResponse.json(
          { error: 'startDate and endDate are required for schedule analytics' },
          { status: 400 }
        );
      }

      const analytics = await calculateScheduleAnalytics(familyId, startDate, endDate);

      return NextResponse.json({
        success: true,
        analytics,
      });
    }

    if (type === 'tasks') {
      const stats = await getTaskCompletionStats(familyId, period as any);

      return NextResponse.json({
        success: true,
        stats,
      });
    }

    if (type === 'time') {
      const analytics = await getTimeSpentAnalytics(familyId, period as any);

      return NextResponse.json({
        success: true,
        analytics,
      });
    }

    return NextResponse.json(
      { error: 'Invalid type. Must be "schedule", "tasks", or "time"' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Failed to get schedule analytics:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get analytics' },
      { status: 500 }
    );
  }
}

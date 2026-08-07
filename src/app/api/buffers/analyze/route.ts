/**
 * POST /api/buffers/analyze
 * Analyze a time range and suggest buffers
 */

import { NextRequest, NextResponse } from 'next/server';
import { suggestBuffers } from '@/lib/auto-buffer-scheduling';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { start, end, location } = body;

    if (!start || !end) {
      return NextResponse.json(
        { error: 'Missing required fields: start, end' },
        { status: 400 }
      );
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format' },
        { status: 400 }
      );
    }

    if (endDate <= startDate) {
      return NextResponse.json(
        { error: 'End time must be after start time' },
        { status: 400 }
      );
    }

    const { buffers, totalBufferTime } = await suggestBuffers({
      start,
      end,
      location,
    });

    return NextResponse.json({
      success: true,
      buffers,
      totalBufferTime,
      bufferCount: buffers.length,
    });
  } catch (error) {
    console.error('Failed to analyze buffers:', error);
    return NextResponse.json(
      { error: 'Failed to analyze buffers' },
      { status: 500 }
    );
  }
}

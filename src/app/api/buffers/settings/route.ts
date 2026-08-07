/**
 * GET /api/buffers/settings
 * Get buffer scheduling settings
 */

import { NextResponse } from 'next/server';
import { getBufferSettings } from '@/lib/auto-buffer-scheduling';

export async function GET() {
  try {
    const settings = await getBufferSettings();
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('Failed to get buffer settings:', error);
    return NextResponse.json(
      { error: 'Failed to get buffer settings' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/buffers/settings
 * Update buffer scheduling settings
 */

import { NextRequest } from 'next/server';
import { saveBufferSettings } from '@/lib/auto-buffer-scheduling';
import type { BufferSettings } from '@/lib/auto-buffer-scheduling';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const settings: BufferSettings = body;

    // Validate settings
    if (typeof settings.enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 }
      );
    }

    if (typeof settings.defaultBufferMinutes !== 'number' || settings.defaultBufferMinutes < 0) {
      return NextResponse.json(
        { error: 'defaultBufferMinutes must be a non-negative number' },
        { status: 400 }
      );
    }

    if (typeof settings.travelTimeMinutes !== 'number' || settings.travelTimeMinutes < 0) {
      return NextResponse.json(
        { error: 'travelTimeMinutes must be a non-negative number' },
        { status: 400 }
      );
    }

    if (typeof settings.minGapMinutes !== 'number' || settings.minGapMinutes < 0) {
      return NextResponse.json(
        { error: 'minGapMinutes must be a non-negative number' },
        { status: 400 }
      );
    }

    await saveBufferSettings(settings);

    return NextResponse.json({ success: true, message: 'Buffer settings updated' });
  } catch (error) {
    console.error('Failed to save buffer settings:', error);
    return NextResponse.json(
      { error: 'Failed to save buffer settings' },
      { status: 500 }
    );
  }
}

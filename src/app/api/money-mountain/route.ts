import { NextRequest, NextResponse } from 'next/server';
import { getUserMountains, createMountain } from '@/lib/money-mountain';
import { getUserId } from '@/lib/auth';
import { requireLiveSession } from '@/lib/server-auth';
import type { Currency } from '@/db/features/money-mountain';

/**
 * GET /api/money-mountain
 * Get all mountains for the current user.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    const mountains = await getUserMountains(userId);
    
    return NextResponse.json({ mountains });
  } catch (error) {
    console.error('Failed to get mountains:', error);
    return NextResponse.json(
      { error: 'Failed to get mountains' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/money-mountain
 * Create a new savings goal (mountain) — parent-only, like every other write
 * in this domain. The gate re-reads the LIVE PocketBase role (the cookie's role
 * claim is never trusted alone) and a PocketBase outage is a 503
 * `identity_unavailable` rather than an open door; same `requireLiveSession`
 * seam as /api/money-mountain/[id], /api/consuela/planner/apply and
 * /api/recipes/ingest.
 *
 * The body is rebuilt field by field, so a caller cannot smuggle a balance:
 * `createMountain` stamps `currentAmount: 0` and zeroes every counter itself,
 * and nothing the caller sends can reach those columns.
 */
export async function POST(request: NextRequest) {
  const live = await requireLiveSession(request, { requireRole: 'parent' });
  if (!live.ok) {
    return NextResponse.json({ error: live.error }, { status: live.status });
  }

  try {
    const userId = await getUserId(request);

    let data: any;
    try {
      data = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body could not be read' }, { status: 400 });
    }

    // Validation
    if (!data?.name || !data?.targetAmount) {
      return NextResponse.json(
        { error: 'Name and target amount are required' },
        { status: 400 }
      );
    }
    
    if (data.targetAmount <= 0) {
      return NextResponse.json(
        { error: 'Target amount must be greater than 0' },
        { status: 400 }
      );
    }

    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) {
      return NextResponse.json(
        { error: 'Name and target amount are required' },
        { status: 400 }
      );
    }
    if (name.length > 80) {
      return NextResponse.json(
        { error: 'Name must be 80 characters or fewer' },
        { status: 400 }
      );
    }
    if (typeof data.targetAmount !== 'number' || !Number.isFinite(data.targetAmount)) {
      return NextResponse.json(
        { error: 'Target amount must be a real number' },
        { status: 400 }
      );
    }

    const CURRENCIES: ReadonlySet<string> = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD']);
    const THEMES: ReadonlySet<string> = new Set([
      'snow',
      'desert',
      'forest',
      'volcano',
      'cloud',
    ]);
    const optionalText = (value: unknown, max: number): string | undefined => {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      return trimmed && trimmed.length <= max ? trimmed : undefined;
    };
    const optionalNumber = (
      value: unknown,
      bounds: { min: number; max?: number },
    ): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) && value >= bounds.min &&
      (bounds.max === undefined || value <= bounds.max)
        ? value
        : undefined;

    const imageUrl = optionalText(data.imageUrl, 500);
    const icon = optionalText(data.icon, 8);
    const color = optionalText(data.color, 32);
    const description = optionalText(data.description, 500);
    const deadline = optionalText(data.deadline, 40);

    const mountain = await createMountain(userId, {
      name,
      targetAmount: data.targetAmount,
      ...(description ? { description } : {}),
      ...(CURRENCIES.has(String(data.currency))
        ? { currency: String(data.currency) as Currency }
        : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(icon ? { icon } : {}),
      ...(color ? { color } : {}),
      ...(THEMES.has(String(data.mountainTheme))
        ? {
            mountainTheme: String(data.mountainTheme) as
              | 'snow'
              | 'desert'
              | 'forest'
              | 'volcano'
              | 'cloud',
          }
        : {}),
      ...(deadline && !Number.isNaN(Date.parse(deadline)) ? { deadline } : {}),
      ...(typeof data.matchEnabled === 'boolean' ? { matchEnabled: data.matchEnabled } : {}),
      ...(optionalNumber(data.matchPercentage, { min: 0, max: 100 }) !== undefined
        ? { matchPercentage: optionalNumber(data.matchPercentage, { min: 0, max: 100 })! }
        : {}),
      ...(optionalNumber(data.matchCap, { min: 0 }) !== undefined
        ? { matchCap: optionalNumber(data.matchCap, { min: 0 })! }
        : {}),
    });
    
    if (!mountain) {
      return NextResponse.json(
        { error: 'Failed to create mountain' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ mountain }, { status: 201 });
  } catch (error) {
    console.error('Failed to create mountain:', error);
    return NextResponse.json(
      { error: 'Failed to create mountain' },
      { status: 500 }
    );
  }
}

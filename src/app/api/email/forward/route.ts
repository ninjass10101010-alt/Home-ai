/**
 * POST /api/email/forward
 * Process forwarded email and create calendar events or tasks
 */

import { NextRequest, NextResponse } from 'next/server';
import { processEmailForward } from '@/lib/email-forwarding';
import { getPB } from '@/lib/pb';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { subject, body: emailBody, from, date } = body;

    if (!subject || !emailBody) {
      return NextResponse.json(
        { error: 'Email subject and body are required' },
        { status: 400 }
      );
    }

    // Get family context for parsing
    const pb = getPB();
    const familyMembers = await pb.collection('users').getFullList({
      requestKey: null,
    });

    const savedLocations = await pb.collection('consuela_saved_locations').getFullList({
      requestKey: null,
    });

    // Process the email
    const result = await processEmailForward(
      { subject, body: emailBody, from, date },
      {
        familyMembers: familyMembers.map((m: any) => ({
          name: m.name,
          id: m.id,
          role: m.role,
        })),
        savedLocations: savedLocations.map((l: any) => ({
          name: l.name,
          address: l.address,
        })),
      }
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to process email' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      subject: result.subject,
      parsed: result.parsed,
      clarification: result.clarification,
    });

  } catch (error: any) {
    console.error('Email forwarding error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process email' },
      { status: 500 }
    );
  }
}

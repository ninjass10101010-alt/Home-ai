/**
 * POST /api/voice/process
 * Process voice input and convert to structured calendar events or tasks
 */

import { NextRequest, NextResponse } from 'next/server';
import { processVoiceInput } from '@/lib/voice-input';
import { getPB } from '@/lib/pb';

export async function POST(request: NextRequest) {
  try {
    // Get audio from request
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'Audio file is required' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!audioFile.type.startsWith('audio/')) {
      return NextResponse.json(
        { error: 'File must be an audio file' },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    if (audioFile.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Audio file must be less than 10MB' },
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

    // Convert File to Blob
    const audioBlob = new Blob([await audioFile.arrayBuffer()], { type: audioFile.type });

    // Process the voice input
    const result = await processVoiceInput(audioBlob, {
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

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to process voice input' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      transcript: result.transcript,
      parsed: result.parsed,
      clarification: result.clarification,
    });

  } catch (error: any) {
    console.error('Voice processing error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process voice input' },
      { status: 500 }
    );
  }
}

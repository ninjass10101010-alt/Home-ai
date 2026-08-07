/**
 * POST /api/photo/process
 * Process photo input (flyers, invitations) and convert to structured calendar events
 */

import { NextRequest, NextResponse } from 'next/server';
import { processPhotoInput } from '@/lib/photo-input';
import { getPB } from '@/lib/pb';

export async function POST(request: NextRequest) {
  try {
    // Get image from request
    const formData = await request.formData();
    const imageFile = formData.get('image') as File;

    if (!imageFile) {
      return NextResponse.json(
        { error: 'Image file is required' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!imageFile.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    if (imageFile.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Image must be less than 10MB' },
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
    const imageBlob = new Blob([await imageFile.arrayBuffer()], { type: imageFile.type });

    // Process the photo input
    const result = await processPhotoInput(imageBlob, {
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
        { error: result.error || 'Failed to process photo input' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      text: result.text,
      parsed: result.parsed,
      clarification: result.clarification,
    });

  } catch (error: any) {
    console.error('Photo processing error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process photo input' },
      { status: 500 }
    );
  }
}

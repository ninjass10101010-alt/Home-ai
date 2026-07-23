/**
 * PATCH /api/family-memory/[id]
 * Update an existing memory
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateMemory, deleteMemory, incrementMemoryUsage } from '@/lib/family-memory';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { content, tags, confidence } = body;

    const memory = await updateMemory(params.id, {
      content,
      tags,
      confidence,
    });

    if (!memory) {
      return NextResponse.json(
        { error: 'Failed to update memory' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      memory,
    });
  } catch (error: any) {
    console.error('Failed to update memory:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update memory' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/family-memory/[id]
 * Delete a memory
 */

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const success = await deleteMemory(params.id);

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to delete memory' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Memory deleted successfully',
    });
  } catch (error: any) {
    console.error('Failed to delete memory:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete memory' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/family-memory/[id]/use
 * Increment usage count for a memory
 */

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await incrementMemoryUsage(params.id);

    return NextResponse.json({
      success: true,
      message: 'Memory usage incremented',
    });
  } catch (error: any) {
    console.error('Failed to increment memory usage:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to increment usage' },
      { status: 500 }
    );
  }
}

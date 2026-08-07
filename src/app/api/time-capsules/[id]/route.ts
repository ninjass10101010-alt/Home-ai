import { getUserId } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  getCapsule,
  updateCapsule,
  deleteCapsule,
  addCapsuleContent,
  markCapsuleViewed,
} from '@/lib/time-capsule';
import type { AddContentRequest, UpdateCapsuleRequest } from '@/db/features/time-capsule';

/**
 * GET /api/time-capsules/[id]
 * Get a single time capsule with its contents.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserId(request);
    const capsuleId = params.id;
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 401 }
      );
    }
    
    const result = await getCapsule(capsuleId);
    
    if (!result) {
      return NextResponse.json(
        { error: 'Capsule not found' },
        { status: 404 }
      );
    }
    
    // Check if user can view this capsule
    const { capsule } = result;
    const canView =
      capsule.createdBy === userId ||
      capsule.recipients.includes(userId) ||
      capsule.isFamilyWide;
    
    if (!canView) {
      return NextResponse.json(
        { error: 'You do not have permission to view this capsule' },
        { status: 403 }
      );
    }
    
    // Check if capsule is unlocked or user is the creator
    const isUnlocked = capsule.status === 'unlocked' || capsule.status === 'archived';
    const isCreator = capsule.createdBy === userId;
    
    // Only show contents if unlocked or creator viewing early
    if (!isUnlocked && !isCreator) {
      return NextResponse.json({
        capsule,
        contents: [], // Hide contents until unlocked
        locked: true,
      });
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to get time capsule:', error);
    return NextResponse.json(
      { error: 'Failed to get time capsule' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/time-capsules/[id]
 * Update a time capsule.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserId(request);
    const capsuleId = params.id;
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 401 }
      );
    }
    
    // Check if user owns this capsule
    const existing = await getCapsule(capsuleId);
    if (!existing || existing.capsule.createdBy !== userId) {
      return NextResponse.json(
        { error: 'You do not have permission to update this capsule' },
        { status: 403 }
      );
    }
    
    const data: UpdateCapsuleRequest = await request.json();
    const capsule = await updateCapsule(capsuleId, data);
    
    if (!capsule) {
      return NextResponse.json(
        { error: 'Failed to update time capsule' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ capsule });
  } catch (error) {
    console.error('Failed to update time capsule:', error);
    return NextResponse.json(
      { error: 'Failed to update time capsule' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/time-capsules/[id]
 * Delete a time capsule.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserId(request);
    const capsuleId = params.id;
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 401 }
      );
    }
    
    // Check if user owns this capsule
    const existing = await getCapsule(capsuleId);
    if (!existing || existing.capsule.createdBy !== userId) {
      return NextResponse.json(
        { error: 'You do not have permission to delete this capsule' },
        { status: 403 }
      );
    }
    
    const success = await deleteCapsule(capsuleId);
    
    if (!success) {
      return NextResponse.json(
        { error: 'Failed to delete time capsule' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete time capsule:', error);
    return NextResponse.json(
      { error: 'Failed to delete time capsule' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/time-capsules/[id]/content
 * Add content to a time capsule.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserId(request);
    const capsuleId = params.id;
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 401 }
      );
    }
    
    // Check if user can add to this capsule
    const existing = await getCapsule(capsuleId);
    if (!existing) {
      return NextResponse.json(
        { error: 'Capsule not found' },
        { status: 404 }
      );
    }
    
    const { capsule } = existing;
    const canAdd =
      capsule.createdBy === userId ||
      capsule.recipients.includes(userId) ||
      capsule.isFamilyWide;
    
    if (!canAdd) {
      return NextResponse.json(
        { error: 'You do not have permission to add content to this capsule' },
        { status: 403 }
      );
    }
    
    // Check if capsule is still locked (can only add to locked capsules)
    if (capsule.status !== 'locked') {
      return NextResponse.json(
        { error: 'Cannot add content to an unlocked capsule' },
        { status: 400 }
      );
    }
    
    const data: AddContentRequest = await request.json();
    
    // Validation
    if (!data.type || !data.data) {
      return NextResponse.json(
        { error: 'Type and data are required' },
        { status: 400 }
      );
    }
    
    const content = await addCapsuleContent(capsuleId, userId, data);
    
    if (!content) {
      return NextResponse.json(
        { error: 'Failed to add content' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ content }, { status: 201 });
  } catch (error) {
    console.error('Failed to add capsule content:', error);
    return NextResponse.json(
      { error: 'Failed to add content' },
      { status: 500 }
    );
  }
}

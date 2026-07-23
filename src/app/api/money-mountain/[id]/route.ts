import { getUserId } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  getMountain,
  updateMountain,
  deleteMountain,
  addTransaction,
} from '@/lib/money-mountain';
import type { TransactionType, TransactionSource } from '@/db/features/money-mountain';

/**
 * GET /api/money-mountain/[id]
 * Get a single mountain with milestones and transactions.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserId(request);
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 401 }
      );
    }
    
    const result = await getMountain(params.id);
    
    if (!result) {
      return NextResponse.json(
        { error: 'Mountain not found' },
        { status: 404 }
      );
    }
    
    // Check ownership
    if (result.mountain.userId !== userId) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to get mountain:', error);
    return NextResponse.json(
      { error: 'Failed to get mountain' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/money-mountain/[id]
 * Update a mountain.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserId(request);
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 401 }
      );
    }
    
    // Check ownership
    const existing = await getMountain(params.id);
    if (!existing || existing.mountain.userId !== userId) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }
    
    const data = await request.json();
    const mountain = await updateMountain(params.id, data);
    
    if (!mountain) {
      return NextResponse.json(
        { error: 'Failed to update mountain' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ mountain });
  } catch (error) {
    console.error('Failed to update mountain:', error);
    return NextResponse.json(
      { error: 'Failed to update mountain' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/money-mountain/[id]
 * Delete a mountain.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserId(request);
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 401 }
      );
    }
    
    // Check ownership
    const existing = await getMountain(params.id);
    if (!existing || existing.mountain.userId !== userId) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }
    
    const success = await deleteMountain(params.id);
    
    if (!success) {
      return NextResponse.json(
        { error: 'Failed to delete mountain' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete mountain:', error);
    return NextResponse.json(
      { error: 'Failed to delete mountain' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/money-mountain/[id]/transaction
 * Add a transaction to a mountain.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserId(request);
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 401 }
      );
    }
    
    // Check ownership
    const existing = await getMountain(params.id);
    if (!existing || existing.mountain.userId !== userId) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }
    
    const data = await request.json();
    
    // Validation
    if (!data.type || !data.amount || !data.description || !data.source) {
      return NextResponse.json(
        { error: 'Type, amount, description, and source are required' },
        { status: 400 }
      );
    }
    
    if (data.amount <= 0) {
      return NextResponse.json(
        { error: 'Amount must be greater than 0' },
        { status: 400 }
      );
    }
    
    const result = await addTransaction(params.id, userId, {
      type: data.type as TransactionType,
      amount: data.amount,
      description: data.description,
      source: data.source as TransactionSource,
      note: data.note,
      parentId: data.parentId,
    });
    
    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to add transaction. Insufficient funds for withdrawal.' },
        { status: 400 }
      );
    }
    
    return NextResponse.json({
      success: true,
      matchAmount: result.matchAmount,
      milestoneReached: result.milestoneReached,
    }, { status: 201 });
  } catch (error) {
    console.error('Failed to add transaction:', error);
    return NextResponse.json(
      { error: 'Failed to add transaction' },
      { status: 500 }
    );
  }
}

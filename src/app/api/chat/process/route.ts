/**
 * POST /api/chat/process
 * Process message with enhanced AI (conflict detection, auto-buffer, clarification)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '@/lib/auth';
import { processMessageWithClarification } from '@/lib/consuela-ai-enhanced';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, history = [] } = body;

    if (!message || !message.trim()) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Get user ID from auth (or use demo user)
    const userId = getUserId(request) || 'demo-user';

    // Process message with enhanced AI
    const result = await processMessageWithClarification(message, userId);

    return NextResponse.json({
      success: true,
      reply: result.reply,
      clarification: result.clarification,
      conflicts: result.conflicts,
      buffers: result.buffers,
      actions: result.actions,
    });

  } catch (error: any) {
    console.error('Chat processing error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process message' },
      { status: 500 }
    );
  }
}

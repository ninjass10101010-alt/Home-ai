/**
 * POST /api/consuela/chat
 * Chat with Consuela AI assistant
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '@/lib/auth';
import { getPB } from '@/lib/pb';
import { getAdminPB } from '@/lib/pb';
import { buildSystemPrompt, buildContextSnapshot } from '@/db/features/family-ai';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversationId, history = [] } = body;

    if (!message || !message.trim()) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Get user ID from auth (or use demo user)
    const userId = getUserId(request) || 'demo-user';

    // Get or create conversation
    let convId = conversationId;
    if (!convId) {
      const pb = getAdminPB();
      const conv = await pb.collection('conversations').create({
        userId,
        title: message.slice(0, 50),
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        messageCount: 1,
        actionCount: 0,
        isActive: true,
      });
      convId = conv.id;
    }

    // Save user message
    const pb = getAdminPB();
    await pb.collection('conversation_messages').create({
      conversationId: convId,
      role: 'user',
      content: message,
    });

    // Build AI response
    const context = buildContextSnapshot([], [], []);
    const preferences = {
      preferredTone: 'casual' as const,
      emojiUsage: 'moderate' as const,
      responseLength: 'moderate' as const,
      enableProactiveSuggestions: true,
      suggestionFrequency: 'medium' as const,
      shareCalendarContext: true,
      shareLocationContext: false,
      sharePreferenceContext: true,
      allowLearningFromFeedback: true,
      allowConversationHistory: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      id: '',
      userId,
    };

    const systemPrompt = buildSystemPrompt(context, preferences);

    // TODO: Call actual AI API (OpenAI, Hermes, etc.)
    const reply = `I received your message: "${message}". I'm Consuela, your family AI assistant. How can I help you today?`;

    // Save assistant message
    await pb.collection('conversation_messages').create({
      conversationId: convId,
      role: 'assistant',
      content: reply,
    });

    // Update conversation
    await pb.collection('conversations').update(convId, {
      lastMessageAt: new Date().toISOString(),
      messageCount: 2,
    });

    return NextResponse.json({
      success: true,
      reply,
      conversationId: convId,
    });
  } catch (error: any) {
    console.error('Consuela chat error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process message' },
      { status: 500 }
    );
  }
}

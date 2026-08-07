/**
 * AI Family Memory Bank
 * Stores and retrieves family preferences, routines, and contextual information
 * in natural language for personalized AI assistance
 */

import { getPB } from './pb';

export interface FamilyMemory {
  id: string;
  userId: string;
  familyId: string;
  category: MemoryCategory;
  key: string; // Short identifier (e.g., "caspian_allergies")
  content: string; // Natural language description
  tags: string[];
  confidence: number; // 0-1, how confident the AI is about this memory
  createdAt: string;
  updatedAt: string;
  lastUsed?: string;
  usageCount: number;
}

export type MemoryCategory =
  | 'preference' // Food preferences, activity preferences
  | 'allergy' // Allergies, medical conditions
  | 'routine' // Daily routines, weekly patterns
  | 'location' // Common addresses, favorite places
  | 'schedule' // Recurring events, time preferences
  | 'personality' // Personality traits, interests
  | 'restriction' // Dietary restrictions, screen time limits
  | 'contact' // Contact information, relationships
  | 'note'; // General notes

export interface MemoryQuery {
  userId?: string;
  familyId?: string;
  category?: MemoryCategory;
  key?: string;
  tags?: string[];
  search?: string; // Full-text search
  limit?: number;
}

export interface MemoryUpdate {
  content?: string;
  tags?: string[];
  confidence?: number;
}

/**
 * Store a new memory in the family memory bank
 */
export async function storeMemory(
  userId: string,
  familyId: string,
  category: MemoryCategory,
  key: string,
  content: string,
  tags: string[] = [],
  confidence: number = 0.8
): Promise<FamilyMemory | null> {
  try {
    const pb = getPB();
    
    // Check if memory already exists
    const existing = await pb.collection('consuela_family_memories').getFirstListItem(
      `userId = "${userId}" && key = "${key}"`,
      { requestKey: null }
    ).catch(() => null);

    if (existing) {
      // Update existing memory
      const updated = await pb.collection('consuela_family_memories').update(
        existing.id,
        {
          content,
          tags: JSON.stringify(tags),
          confidence,
          updatedAt: new Date().toISOString(),
          usageCount: (existing.usageCount || 0) + 1,
          lastUsed: new Date().toISOString(),
        },
        { requestKey: null }
      );
      return updated as unknown as FamilyMemory;
    }

    // Create new memory
    const memory = await pb.collection('consuela_family_memories').create(
      {
        userId,
        familyId,
        category,
        key,
        content,
        tags: JSON.stringify(tags),
        confidence,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 1,
        lastUsed: new Date().toISOString(),
      },
      { requestKey: null }
    );

    return memory as unknown as FamilyMemory;
  } catch (error) {
    console.error('Failed to store memory:', error);
    return null;
  }
}

/**
 * Retrieve memories matching a query
 */
export async function queryMemories(query: MemoryQuery): Promise<FamilyMemory[]> {
  try {
    const pb = getPB();
    const filters: string[] = [];

    if (query.userId) filters.push(`userId = "${query.userId}"`);
    if (query.familyId) filters.push(`familyId = "${query.familyId}"`);
    if (query.category) filters.push(`category = "${query.category}"`);
    if (query.key) filters.push(`key = "${query.key}"`);

    const filterStr = filters.length > 0 ? filters.join(' && ') : '';
    const limit = query.limit || 50;

    let memories: FamilyMemory[];
    
    if (query.search) {
      // Full-text search
      memories = await pb.collection('consuela_family_memories').getFullList({
        filter: filterStr ? `${filterStr} && content ~ "${query.search}"` : `content ~ "${query.search}"`,
        sort: '-confidence,-usageCount',
        requestKey: null,
      }) as unknown as FamilyMemory[];
    } else if (filterStr) {
      memories = await pb.collection('consuela_family_memories').getFullList({
        filter: filterStr,
        sort: '-confidence,-usageCount',
        requestKey: null,
      }) as unknown as FamilyMemory[];
    } else {
      memories = await pb.collection('consuela_family_memories').getFullList({
        sort: '-confidence,-usageCount',
        requestKey: null,
      }) as unknown as FamilyMemory[];
    }

    // Filter by tags if provided
    if (query.tags && query.tags.length > 0) {
      memories = memories.filter(m => {
        const memoryTags = typeof m.tags === 'string' ? JSON.parse(m.tags) : m.tags;
        return query.tags!.some(tag => memoryTags.includes(tag));
      });
    }

    // Apply limit
    return memories.slice(0, limit);
  } catch (error) {
    console.error('Failed to query memories:', error);
    return [];
  }
}

/**
 * Get memories relevant to a specific person
 */
export async function getPersonMemories(
  familyId: string,
  personName: string
): Promise<FamilyMemory[]> {
  return queryMemories({
    familyId,
    search: personName,
    limit: 20,
  });
}

/**
 * Get all memories for a family
 */
export async function getFamilyMemories(familyId: string): Promise<FamilyMemory[]> {
  return queryMemories({
    familyId,
    limit: 100,
  });
}

/**
 * Update a memory
 */
export async function updateMemory(
  memoryId: string,
  updates: MemoryUpdate
): Promise<FamilyMemory | null> {
  try {
    const pb = getPB();
    const updateData: any = {
      updatedAt: new Date().toISOString(),
    };

    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.tags !== undefined) updateData.tags = JSON.stringify(updates.tags);
    if (updates.confidence !== undefined) updateData.confidence = updates.confidence;

    const memory = await pb.collection('consuela_family_memories').update(
      memoryId,
      updateData,
      { requestKey: null }
    );

    return memory as unknown as FamilyMemory;
  } catch (error) {
    console.error('Failed to update memory:', error);
    return null;
  }
}

/**
 * Delete a memory
 */
export async function deleteMemory(memoryId: string): Promise<boolean> {
  try {
    const pb = getPB();
    await pb.collection('consuela_family_memories').delete(memoryId, {
      requestKey: null,
    });
    return true;
  } catch (error) {
    console.error('Failed to delete memory:', error);
    return false;
  }
}

/**
 * Extract memories from natural language using AI
 * Returns structured memories that can be stored
 */
export async function extractMemoriesFromText(
  text: string,
  userId: string,
  familyId: string
): Promise<Array<{
  category: MemoryCategory;
  key: string;
  content: string;
  tags: string[];
  confidence: number;
}>> {
  // This would typically call an AI service to extract structured data
  // For now, return empty array - implementation would use OpenAI/Claude
  // to parse natural language and extract memories
  
  // Example implementation:
  // const response = await openai.chat.completions.create({
  //   model: 'gpt-4',
  //   messages: [{
  //     role: 'system',
  //     content: 'Extract family memories from this text. Return JSON array of memories with category, key, content, tags, and confidence.'
  //   }, {
  //     role: 'user',
  //     content: text
  //   }]
  // });
  
  return [];
}

/**
 * Build context for AI conversations using family memories
 */
export async function buildMemoryContext(
  userId: string,
  familyId: string,
  currentMessage: string
): Promise<string> {
  try {
    // Get relevant memories based on current message
    const relevantMemories = await queryMemories({
      userId,
      familyId,
      search: currentMessage,
      limit: 10,
    });

    if (relevantMemories.length === 0) {
      return '';
    }

    // Format memories as context
    const contextLines = relevantMemories.map(m => {
      const tags = typeof m.tags === 'string' ? JSON.parse(m.tags) : m.tags;
      return `- ${m.category}: ${m.content} ${tags.length > 0 ? `(${tags.join(', ')})` : ''}`;
    });

    return `\nFamily Context:\n${contextLines.join('\n')}\n`;
  } catch (error) {
    console.error('Failed to build memory context:', error);
    return '';
  }
}

/**
 * Increment usage count for a memory (for learning)
 */
export async function incrementMemoryUsage(memoryId: string): Promise<void> {
  try {
    const pb = getPB();
    const memory = await pb.collection('consuela_family_memories').getOne(memoryId, {
      requestKey: null,
    });

    await pb.collection('consuela_family_memories').update(
      memoryId,
      {
        usageCount: (memory.usageCount || 0) + 1,
        lastUsed: new Date().toISOString(),
      },
      { requestKey: null }
    );
  } catch (error) {
    console.error('Failed to increment memory usage:', error);
  }
}

/**
 * Parse "remember" commands from user input
 */
export function parseRememberCommand(text: string): {
  isRememberCommand: boolean;
  category: MemoryCategory;
  key: string;
  content: string;
} | null {
  const lower = text.toLowerCase();
  
  // Check for "remember" patterns
  const rememberPatterns = [
    { pattern: /^remember that (.+)$/i, category: 'note' as MemoryCategory },
    { pattern: /^(.+) is allergic to (.+)$/i, category: 'allergy' as MemoryCategory },
    { pattern: /^(.+) doesn't like (.+)$/i, category: 'preference' as MemoryCategory },
    { pattern: /^(.+) loves (.+)$/i, category: 'preference' as MemoryCategory },
    { pattern: /our (wifi|wi-fi) password is (.+)$/i, category: 'contact' as MemoryCategory },
    { pattern: /we live at (.+)$/i, category: 'location' as MemoryCategory },
  ];

  for (const { pattern, category } of rememberPatterns) {
    const match = text.match(pattern);
    if (match) {
      const content = match[0];
      const key = content.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 50);
      
      return {
        isRememberCommand: true,
        category,
        key,
        content,
      };
    }
  }

  return null;
}

/**
 * Get statistics about family memories
 */
export async function getMemoryStats(familyId: string): Promise<{
  totalMemories: number;
  byCategory: Record<string, number>;
  mostUsedMemories: FamilyMemory[];
  recentlyUpdated: FamilyMemory[];
}> {
  try {
    const allMemories = await getFamilyMemories(familyId);
    
    const byCategory: Record<string, number> = {};
    allMemories.forEach(m => {
      byCategory[m.category] = (byCategory[m.category] || 0) + 1;
    });

    const mostUsedMemories = [...allMemories]
      .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
      .slice(0, 10);

    const recentlyUpdated = [...allMemories]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10);

    return {
      totalMemories: allMemories.length,
      byCategory,
      mostUsedMemories,
      recentlyUpdated,
    };
  } catch (error) {
    console.error('Failed to get memory stats:', error);
    return {
      totalMemories: 0,
      byCategory: {},
      mostUsedMemories: [],
      recentlyUpdated: [],
    };
  }
}

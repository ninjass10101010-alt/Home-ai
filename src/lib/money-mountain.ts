import { getPB } from '@/lib/pb';
import type {
  MoneyMountain,
  MountainTransaction,
  AllowanceSettings,
  TransactionType,
  TransactionSource,
  Currency,
} from '@/db/features/money-mountain';
import {
  calculatePercentage,
  getMilestoneIndex,
  calculateMatch,
  DEFAULT_MILESTONES,
} from '@/db/features/money-mountain';

/**
 * Get all mountains for a user.
 */
export async function getUserMountains(userId: string): Promise<MoneyMountain[]> {
  const pb = getPB();
  
  try {
    const mountains = await pb.collection('money_mountains').getFullList<MoneyMountain>({
      filter: `userId = "${userId}"`,
      sort: '-created',
    });
    
    return mountains;
  } catch (error) {
    console.error('Failed to get user mountains:', error);
    return [];
  }
}

/**
 * Get a single mountain with milestones and transactions.
 */
export async function getMountain(mountainId: string): Promise<{
  mountain: MoneyMountain;
  milestones: any[];
  transactions: MountainTransaction[];
} | null> {
  const pb = getPB();
  
  try {
    const mountain = await pb.collection('money_mountains').getOne<MoneyMountain>(mountainId);
    
    const milestones = await pb.collection('mountain_milestones').getFullList({
      filter: `mountainId = "${mountainId}"`,
      sort: 'percentage',
    });
    
    const transactions = await pb.collection('mountain_transactions').getFullList<MountainTransaction>({
      filter: `mountainId = "${mountainId}"`,
      sort: '-date',
    });
    
    return { mountain, milestones, transactions };
  } catch (error) {
    console.error('Failed to get mountain:', error);
    return null;
  }
}

/**
 * Create a new savings goal (mountain).
 */
export async function createMountain(
  userId: string,
  data: {
    name: string;
    description?: string;
    targetAmount: number;
    currency?: Currency;
    imageUrl?: string;
    icon?: string;
    color?: string;
    mountainTheme?: 'snow' | 'desert' | 'forest' | 'volcano' | 'cloud';
    deadline?: string;
    matchEnabled?: boolean;
    matchPercentage?: number;
    matchCap?: number;
  }
): Promise<MoneyMountain | null> {
  const pb = getPB();
  
  try {
    // Create the mountain
    const mountain = await pb.collection('money_mountains').create<MoneyMountain>({
      userId,
      name: data.name,
      description: data.description || '',
      targetAmount: data.targetAmount,
      currentAmount: 0,
      currency: data.currency || 'USD',
      imageUrl: data.imageUrl || '',
      icon: data.icon || '⛰️',
      color: data.color || '#3b82f6',
      mountainTheme: data.mountainTheme || 'snow',
      status: 'active',
      deadline: data.deadline || null,
      isCompleted: false,
      percentageComplete: 0,
      milestoneIndex: 0,
      daysActive: 0,
      matchEnabled: data.matchEnabled || false,
      matchPercentage: data.matchPercentage || 0,
      matchCap: data.matchCap || null,
      matchedAmount: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      transactionCount: 0,
    });
    
    // Create default milestones
    for (const milestone of DEFAULT_MILESTONES) {
      await pb.collection('mountain_milestones').create({
        mountainId: mountain.id,
        percentage: milestone.percentage,
        label: milestone.label,
        icon: milestone.icon,
        isReached: false,
      });
    }
    
    return mountain;
  } catch (error) {
    console.error('Failed to create mountain:', error);
    return null;
  }
}

/**
 * Add a transaction (deposit or withdrawal) to a mountain.
 */
export async function addTransaction(
  mountainId: string,
  userId: string,
  data: {
    type: TransactionType;
    amount: number;
    description: string;
    source: TransactionSource;
    note?: string;
    parentId?: string; // For matching
  }
): Promise<{ success: boolean; matchAmount?: number; milestoneReached?: any }> {
  const pb = getPB();
  
  try {
    const mountain = await pb.collection('money_mountains').getOne<MoneyMountain>(mountainId);
    
    // Validate
    if (data.type === 'withdrawal' && data.amount > mountain.currentAmount) {
      return { success: false };
    }
    
    let matchAmount = 0;
    
    // Calculate match if applicable (only for deposits)
    if (data.type === 'deposit' && mountain.matchEnabled && !data.parentId) {
      matchAmount = calculateMatch(data.amount, mountain.matchPercentage, mountain.matchCap || undefined);
      
      // Check weekly match cap
      if (matchAmount > 0) {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
        const weekStartStr = weekStart.toISOString();
        
        const weeklyMatches = await pb.collection('mountain_transactions').getList(1, 100, {
          filter: `mountainId = "${mountainId}" && isMatch = true && date >= "${weekStartStr}"`,
        });
        
        const weeklyMatchTotal = weeklyMatches.items.reduce((sum: number, tx: any) => sum + tx.amount, 0);
        
        // Reduce match if it would exceed weekly cap (if set)
        // For now, just apply the match
      }
    }
    
    // Create the transaction
    const transaction = await pb.collection('mountain_transactions').create({
      mountainId,
      userId,
      type: data.type,
      amount: data.amount,
      currency: mountain.currency,
      date: new Date().toISOString(),
      description: data.description,
      source: data.source,
      isMatch: false,
      note: data.note || '',
      approved: true,
    });
    
    // Create match transaction if applicable
    if (matchAmount > 0 && data.parentId) {
      await pb.collection('mountain_transactions').create({
        mountainId,
        userId: data.parentId,
        type: 'match',
        amount: matchAmount,
        currency: mountain.currency,
        date: new Date().toISOString(),
        description: `Match for: ${data.description}`,
        source: 'match',
        isMatch: true,
        matchParentId: data.parentId,
        originalAmount: data.amount,
        matchAmount: matchAmount,
        approved: true,
      });
    }
    
    // Update mountain
    const totalChange = data.type === 'deposit' 
      ? data.amount + matchAmount 
      : -data.amount;
    
    const newAmount = mountain.currentAmount + totalChange;
    const newPercentage = calculatePercentage(newAmount, mountain.targetAmount);
    const newMilestoneIndex = getMilestoneIndex(newPercentage);
    const milestoneReached = newMilestoneIndex > mountain.milestoneIndex;
    
    const updateData: any = {
      currentAmount: newAmount,
      percentageComplete: newPercentage,
      milestoneIndex: newMilestoneIndex,
      totalDeposits: mountain.totalDeposits + (data.type === 'deposit' ? data.amount + matchAmount : 0),
      totalWithdrawals: mountain.totalWithdrawals + (data.type === 'withdrawal' ? data.amount : 0),
      transactionCount: mountain.transactionCount + (matchAmount > 0 ? 2 : 1),
      matchedAmount: mountain.matchedAmount + matchAmount,
      isCompleted: newPercentage >= 100,
    };
    
    if (newPercentage >= 100 && !mountain.isCompleted) {
      updateData.status = 'completed';
      updateData.completedAt = new Date().toISOString();
    }
    
    await pb.collection('money_mountains').update(mountainId, updateData);
    
    // Update milestone if reached
    let milestoneData = null;
    if (milestoneReached) {
      const milestone = await pb.collection('mountain_milestones').getFirstListItem(
        `mountainId = "${mountainId}" && percentage = ${newMilestoneIndex * 25}`
      );
      
      if (milestone && !milestone.isReached) {
        await pb.collection('mountain_milestones').update(milestone.id, {
          isReached: true,
          reachedAt: new Date().toISOString(),
        });
        milestoneData = milestone;
      }
    }
    
    return {
      success: true,
      matchAmount: matchAmount > 0 ? matchAmount : undefined,
      milestoneReached: milestoneData,
    };
  } catch (error) {
    console.error('Failed to add transaction:', error);
    return { success: false };
  }
}

/**
 * Update a mountain.
 */
export async function updateMountain(
  mountainId: string,
  data: Partial<MoneyMountain>
): Promise<MoneyMountain | null> {
  const pb = getPB();
  
  try {
    const mountain = await pb.collection('money_mountains').update<MoneyMountain>(mountainId, data);
    return mountain;
  } catch (error) {
    console.error('Failed to update mountain:', error);
    return null;
  }
}

/**
 * Delete a mountain and all its data.
 */
export async function deleteMountain(mountainId: string): Promise<boolean> {
  const pb = getPB();
  
  try {
    // Delete milestones
    const milestones = await pb.collection('mountain_milestones').getFullList({
      filter: `mountainId = "${mountainId}"`,
    });
    for (const milestone of milestones) {
      await pb.collection('mountain_milestones').delete(milestone.id);
    }
    
    // Delete transactions
    const transactions = await pb.collection('mountain_transactions').getFullList({
      filter: `mountainId = "${mountainId}"`,
    });
    for (const transaction of transactions) {
      await pb.collection('mountain_transactions').delete(transaction.id);
    }
    
    // Delete mountain
    await pb.collection('money_mountains').delete(mountainId);
    return true;
  } catch (error) {
    console.error('Failed to delete mountain:', error);
    return false;
  }
}

/**
 * Get allowance settings for a parent-child pair.
 */
export async function getAllowanceSettings(
  parentId: string,
  childId: string
): Promise<AllowanceSettings | null> {
  const pb = getPB();
  
  try {
    const settings = await pb.collection('allowance_settings').getFirstListItem<AllowanceSettings>(
      `parentId = "${parentId}" && childId = "${childId}"`
    );
    return settings;
  } catch {
    return null;
  }
}

/**
 * Create or update allowance settings.
 */
export async function saveAllowanceSettings(
  parentId: string,
  childId: string,
  data: Partial<AllowanceSettings>
): Promise<AllowanceSettings | null> {
  const pb = getPB();
  
  try {
    const existing = await getAllowanceSettings(parentId, childId);
    
    if (existing) {
      return await pb.collection('allowance_settings').update<AllowanceSettings>(existing.id, data);
    } else {
      return await pb.collection('allowance_settings').create<AllowanceSettings>({
        parentId,
        childId,
        weeklyAmount: data.weeklyAmount || 0,
        currency: data.currency || 'USD',
        payDay: data.payDay || 5,
        matchEnabled: data.matchEnabled || false,
        matchPercentage: data.matchPercentage || 50,
        requiresApproval: data.requiresApproval !== false,
        spendPercent: data.spendPercent || 50,
        savePercent: data.savePercent || 40,
        givePercent: data.givePercent || 10,
      });
    }
  } catch (error) {
    console.error('Failed to save allowance settings:', error);
    return null;
  }
}

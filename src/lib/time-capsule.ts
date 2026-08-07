import { getPB } from '@/lib/pb';
import type {
  TimeCapsule,
  CapsuleContent,
  CreateCapsuleRequest,
  AddContentRequest,
  UpdateCapsuleRequest,
  ContentType,
} from '@/db/features/time-capsule';
import { getDaysUntilUnlock, isCapsuleUnlocked } from '@/db/features/time-capsule';

/**
 * Get all time capsules for a user.
 */
export async function getUserCapsules(userId: string): Promise<TimeCapsule[]> {
  const pb = getPB();
  
  try {
    const records = await pb.collection('time_capsules').getFullList<TimeCapsule>({
      filter: `createdBy = "${userId}" || recipients ?~ "${userId}" || isFamilyWide = true`,
      sort: '-created',
    });
    
    return records;
  } catch (error) {
    console.error('Failed to get user capsules:', error);
    return [];
  }
}

/**
 * Get a single capsule with its contents.
 */
export async function getCapsule(capsuleId: string): Promise<{
  capsule: TimeCapsule;
  contents: CapsuleContent[];
} | null> {
  const pb = getPB();
  
  try {
    const capsule = await pb.collection('time_capsules').getOne<TimeCapsule>(capsuleId);
    const contents = await pb.collection('capsule_contents').getFullList<CapsuleContent>({
      filter: `capsuleId = "${capsuleId}"`,
      sort: 'order',
    });
    
    return { capsule, contents };
  } catch (error) {
    console.error('Failed to get capsule:', error);
    return null;
  }
}

/**
 * Create a new time capsule.
 */
export async function createCapsule(
  userId: string,
  data: CreateCapsuleRequest
): Promise<TimeCapsule | null> {
  const pb = getPB();
  
  try {
    const capsule = await pb.collection('time_capsules').create<TimeCapsule>({
      title: data.title,
      description: data.description || '',
      unlockDate: data.unlockDate,
      createdBy: userId,
      recipients: data.recipients || [],
      isFamilyWide: data.isFamilyWide,
      status: 'locked',
      contentCount: 0,
      totalSize: 0,
      unlockNotificationSent: false,
      viewedBy: [],
      unlockMessage: data.unlockMessage || '',
      tags: data.tags || [],
      color: data.color || '#3b82f6',
    });
    
    return capsule;
  } catch (error) {
    console.error('Failed to create capsule:', error);
    return null;
  }
}

/**
 * Add content to a capsule.
 */
export async function addCapsuleContent(
  capsuleId: string,
  userId: string,
  data: AddContentRequest
): Promise<CapsuleContent | null> {
  const pb = getPB();
  
  try {
    const content = await pb.collection('capsule_contents').create<CapsuleContent>({
      capsuleId,
      type: data.type,
      data: data.data,
      createdBy: userId,
      caption: data.caption || '',
      order: data.order || 0,
    });
    
    // Update capsule metadata
    const capsule = await pb.collection('time_capsules').getOne<TimeCapsule>(capsuleId);
    await pb.collection('time_capsules').update(capsuleId, {
      contentCount: capsule.contentCount + 1,
      totalSize: capsule.totalSize + (data.data.length * 2), // rough estimate
    });
    
    return content;
  } catch (error) {
    console.error('Failed to add capsule content:', error);
    return null;
  }
}

/**
 * Update a capsule.
 */
export async function updateCapsule(
  capsuleId: string,
  data: UpdateCapsuleRequest
): Promise<TimeCapsule | null> {
  const pb = getPB();
  
  try {
    const capsule = await pb.collection('time_capsules').update<TimeCapsule>(capsuleId, data);
    return capsule;
  } catch (error) {
    console.error('Failed to update capsule:', error);
    return null;
  }
}

/**
 * Delete a capsule and all its contents.
 */
export async function deleteCapsule(capsuleId: string): Promise<boolean> {
  const pb = getPB();
  
  try {
    // Delete all contents first
    const contents = await pb.collection('capsule_contents').getFullList({
      filter: `capsuleId = "${capsuleId}"`,
    });
    
    for (const content of contents) {
      await pb.collection('capsule_contents').delete(content.id);
    }
    
    // Delete the capsule
    await pb.collection('time_capsules').delete(capsuleId);
    return true;
  } catch (error) {
    console.error('Failed to delete capsule:', error);
    return false;
  }
}

/**
 * Mark a capsule as viewed by a user.
 */
export async function markCapsuleViewed(capsuleId: string, userId: string): Promise<void> {
  const pb = getPB();
  
  try {
    const capsule = await pb.collection('time_capsules').getOne<TimeCapsule>(capsuleId);
    
    const viewedBy = capsule.viewedBy || [];
    if (!viewedBy.includes(userId)) {
      viewedBy.push(userId);
      
      const updateData: any = { viewedBy };
      
      // Set first viewed timestamp if this is the first view
      if (viewedBy.length === 1) {
        updateData.firstViewedAt = new Date().toISOString();
      }
      
      await pb.collection('time_capsules').update(capsuleId, updateData);
    }
  } catch (error) {
    console.error('Failed to mark capsule as viewed:', error);
  }
}

/**
 * Check and unlock capsules that are ready to be opened.
 * This should be called periodically (e.g., daily).
 */
export async function checkAndUnlockCapsules(): Promise<number> {
  const pb = getPB();
  
  try {
    const now = new Date().toISOString();
    const lockedCapsules = await pb.collection('time_capsules').getFullList<TimeCapsule>({
      filter: `status = "locked" && unlockDate <= "${now}"`,
    });
    
    let unlockedCount = 0;
    
    for (const capsule of lockedCapsules) {
      await pb.collection('time_capsules').update(capsule.id, {
        status: 'unlocked',
      });
      
      unlockedCount++;
    }
    
    return unlockedCount;
  } catch (error) {
    console.error('Failed to check and unlock capsules:', error);
    return 0;
  }
}

/**
 * Get capsule preview with calculated fields.
 */
export function getCapsulePreview(capsule: TimeCapsule) {
  const daysUntilUnlock = getDaysUntilUnlock(capsule.unlockDate);
  const isUnlocked = isCapsuleUnlocked(capsule);
  
  return {
    id: capsule.id,
    title: capsule.title,
    unlockDate: capsule.unlockDate,
    status: capsule.status,
    contentCount: capsule.contentCount,
    daysUntilUnlock,
    isUnlocked,
  };
}

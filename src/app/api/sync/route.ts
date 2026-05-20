import { NextResponse } from 'next/server';
import { mealSyncService } from '@/services/mealSync';

export async function POST(request: Request) {
  try {
    const { userId, direction } = await request.json();

    if (direction === 'meal-to-grocery') {
      const result = await mealSyncService.syncMealPlanToGrocery(userId);
      return NextResponse.json({ success: true, ...result });
    }

    if (direction === 'pantry-to-grocery') {
      const result = await mealSyncService.syncPantryToGrocery(userId);
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({ error: 'Invalid sync direction' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

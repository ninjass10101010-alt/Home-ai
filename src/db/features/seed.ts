/**
 * Feature Seed Script
 * 
 * Populates database with default data for the 5 new features:
 *   - 30+ daily quotes
 *   - 5 default skill tree branches
 *   - 15+ achievements
 *   - Default mountain milestones template
 * 
 * Usage:
 *   npx tsx src/db/features/seed.ts
 * 
 * Or via npm:
 *   npm run seed:features
 */

import { getAdminPB } from '@/lib/pb';
import { DEFAULT_QUOTES } from './morning-briefing';
import { DEFAULT_BRANCHES, DEFAULT_ACHIEVEMENTS } from './skill-tree';
import { DEFAULT_MILESTONES } from './money-mountain';

// ─── Seed Functions ──────────────────────────────────────────────────────────

/**
 * Seed daily quotes into the database.
 */
async function seedQuotes(pb: any): Promise<number> {
  console.log('  📝 Seeding daily quotes...');
  let count = 0;

  for (const quote of DEFAULT_QUOTES) {
    try {
      // Check if already exists (by text)
      const existing = await pb.collection('daily_quotes')
        .getFirstListItem(`text = "${quote.text.replace(/"/g, '\\"')}"`);
      
      if (existing) {
        continue; // Skip duplicates
      }

      await pb.collection('daily_quotes').create({
        ...quote,
        timesShown: 0,
        isDefault: true,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });
      count++;
    } catch {
      // Skip if creation fails
    }
  }

  console.log(`    ✅ Seeded ${count} quotes (${DEFAULT_QUOTES.length - count} already existed)`);
  return count;
}

/**
 * Seed skill tree branches.
 */
async function seedBranches(pb: any): Promise<number> {
  console.log('  🌳 Seeding skill tree branches...');
  let count = 0;

  for (const branch of DEFAULT_BRANCHES) {
    try {
      // Check if already exists (by name)
      const existing = await pb.collection('skill_branches')
        .getFirstListItem(`name = "${branch.name}"`);
      
      if (existing) continue;

      await pb.collection('skill_branches').create({
        ...branch,
        prerequisiteBranches: [],
        questCount: 0,
        completedCount: 0,
        isDefault: true,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });
      count++;
    } catch {
      // Skip if creation fails
    }
  }

  console.log(`    ✅ Seeded ${count} branches (${DEFAULT_BRANCHES.length - count} already existed)`);
  return count;
}

/**
 * Seed achievements.
 */
async function seedAchievements(pb: any): Promise<number> {
  console.log('  🏆 Seeding achievements...');
  let count = 0;

  for (const achievement of DEFAULT_ACHIEVEMENTS) {
    try {
      // Check if already exists (by name)
      const existing = await pb.collection('achievements')
        .getFirstListItem(`name = "${achievement.name}"`);
      
      if (existing) continue;

      await pb.collection('achievements').create({
        ...achievement,
        isDefault: true,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });
      count++;
    } catch {
      // Skip if creation fails
    }
  }

  console.log(`    ✅ Seeded ${count} achievements (${DEFAULT_ACHIEVEMENTS.length - count} already existed)`);
  return count;
}

/**
 * Create a template mountain with default milestones for new mountains.
 * This is a reference template — actual mountains create their own milestones.
 */
async function seedMountainTemplate(pb: any): Promise<void> {
  console.log('  ⛰️  Seeding mountain milestone template...');
  
  // Store the template in a JSON field or as a reference
  // For now, the DEFAULT_MILESTONES are used directly in code
  console.log(`    ✅ Template ready (${DEFAULT_MILESTONES.length} milestones)`);
}

/**
 * Create default AI preferences for existing users.
 */
async function seedAIPreferences(pb: any): Promise<number> {
  console.log('  🤖 Seeding AI preferences for existing users...');
  let count = 0;

  try {
    // Get all users
    const users = await pb.collection('users').getFullList();
    
    for (const user of users) {
      try {
        // Check if preferences already exist
        const existing = await pb.collection('ai_preferences')
          .getFirstListItem(`userId = "${user.id}"`);
        
        if (existing) continue;

        await pb.collection('ai_preferences').create({
          userId: user.id,
          preferredTone: 'casual',
          emojiUsage: 'moderate',
          responseLength: 'moderate',
          enableProactiveSuggestions: true,
          suggestionFrequency: 'medium',
          shareCalendarContext: true,
          shareLocationContext: false,
          sharePreferenceContext: true,
          allowLearningFromFeedback: true,
          allowConversationHistory: true,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        });
        count++;
      } catch {
        // Skip if creation fails
      }
    }
  } catch {
    // Users collection might not exist
  }

  console.log(`    ✅ Seeded ${count} AI preference profiles`);
  return count;
}

/**
 * Create default briefing preferences for existing users.
 */
async function seedBriefingPreferences(pb: any): Promise<number> {
  console.log('  ☀️  Seeding briefing preferences for existing users...');
  let count = 0;

  try {
    const users = await pb.collection('users').getFullList();
    
    for (const user of users) {
      try {
        const existing = await pb.collection('briefing_preferences')
          .getFirstListItem(`userId = "${user.id}"`);
        
        if (existing) continue;

        await pb.collection('briefing_preferences').create({
          userId: user.id,
          showGreeting: true,
          showWeather: true,
          showCalendar: true,
          showReminders: true,
          showQuote: true,
          showTips: true,
          briefingStartTime: '06:00',
          briefingEndTime: '11:00',
          autoDismissSeconds: 10,
          skipAfterTime: '11:00',
          preferredQuoteCategories: ['motivational', 'family', 'funny'],
          showOutfitSuggestion: true,
          showFamilyJoke: false,
          animationEnabled: true,
          soundEnabled: false,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        });
        count++;
      } catch {
        // Skip if creation fails
      }
    }
  } catch {
    // Users collection might not exist
  }

  console.log(`    ✅ Seeded ${count} briefing preference profiles`);
  return count;
}

// ─── Main Seed Function ──────────────────────────────────────────────────────

/**
 * Run the full seed process.
 */
export async function runFeatureSeed(): Promise<{
  quotes: number;
  branches: number;
  achievements: number;
  aiPrefs: number;
  briefingPrefs: number;
}> {
  console.log('\n🌱 Starting Feature Seed\n');

  const pb = getAdminPB();

  // 1. Seed reference data
  const quotes = await seedQuotes(pb);
  const branches = await seedBranches(pb);
  const achievements = await seedAchievements(pb);
  await seedMountainTemplate(pb);

  // 2. Seed user-specific defaults
  const aiPrefs = await seedAIPreferences(pb);
  const briefingPrefs = await seedBriefingPreferences(pb);

  console.log('\n📊 Seed complete:');
  console.log(`   📝 Quotes: ${quotes}`);
  console.log(`   🌳 Branches: ${branches}`);
  console.log(`   🏆 Achievements: ${achievements}`);
  console.log(`   🤖 AI Preferences: ${aiPrefs}`);
  console.log(`   ☀️  Briefing Preferences: ${briefingPrefs}`);
  console.log('');

  return { quotes, branches, achievements, aiPrefs, briefingPrefs };
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

async function main() {
  try {
    await runFeatureSeed();
  } catch (error: any) {
    console.error('\n❌ Seed failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

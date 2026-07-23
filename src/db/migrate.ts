/**
 * Database Migration Script
 * 
 * This script runs all database migrations:
 * 1. Drizzle ORM migrations (if configured)
 * 2. Feature collection migrations (PocketBase)
 * 
 * Usage:
 *   npm run db:migrate
 *   or: npx tsx src/db/migrate.ts
 */

import { runFeatureMigration } from './features/migrate';

async function main() {
  console.log('🚀 Starting database migration...\n');

  // Note: Drizzle migrations are currently not configured.
  // The app uses PocketBase for all persistence.
  // If you add Drizzle tables in src/db/schema.ts, configure migrations here.
  
  console.log('📦 Running feature migrations...\n');
  
  try {
    const result = await runFeatureMigration();
    
    console.log('\n✅ Migration complete!');
    console.log(`   Created: ${result.created} collections`);
    console.log(`   Skipped: ${result.skipped} collections`);
    console.log(`   Failed: ${result.failed} collections`);
    
    if (result.failed > 0) {
      console.error('\n⚠️  Some collections failed to create. Check the errors above.');
      process.exit(1);
    }
    
    console.log('\n💡 Next step: Run the seed script to populate default data:');
    console.log('   npm run seed:features\n');
    
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Is PocketBase running? Check NEXT_PUBLIC_PB_URL');
    console.error('2. Are admin credentials correct? Check PB_ADMIN_EMAIL/PB_ADMIN_PASS');
    console.error('3. Can you reach PocketBase? Try: curl $NEXT_PUBLIC_PB_URL/api/health');
    process.exit(1);
  }
}

main();

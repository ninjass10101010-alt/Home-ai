/**
 * Feature Schema Migration Script
 * 
 * Creates all PocketBase collections for the 5 new features.
 * Run this script to set up the database schema.
 * 
 * Usage:
 *   npx tsx src/db/features/migrate.ts
 * 
 * Or via npm:
 *   npm run migrate:features
 */

import { getAdminPB } from '@/lib/pb';
import { ALL_FEATURE_SCHEMAS, getFeatureCollectionNames } from './index';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PocketBaseField {
  name: string;
  type: string;
  required?: boolean;
  defaultValue?: any;
  values?: string[];
  collectionId?: string;
  maxSelect?: number | null;
  cascadeDelete?: boolean;
}

interface PocketBaseSchema {
  name: string;
  type: string;
  fields: PocketBaseField[];
  indexes?: string[];
}

// ─── PocketBase API Types ────────────────────────────────────────────────────

interface PBCollection {
  id: string;
  name: string;
  type: string;
  schema: PBField[];
  indexes: string[];
}

interface PBField {
  id: string;
  name: string;
  type: string;
  required: boolean;
  options?: Record<string, any>;
}

// ─── Migration Functions ─────────────────────────────────────────────────────

/**
 * Check if a collection already exists.
 */
async function collectionExists(pb: any, name: string): Promise<boolean> {
  try {
    await pb.collection(name).getList(1, 1);
    return true;
  } catch {
    return false;
  }
}

/**
 * Map our schema field type to PocketBase field type.
 */
function mapFieldType(type: string): string {
  const typeMap: Record<string, string> = {
    text: 'text',
    number: 'number',
    bool: 'bool',
    date: 'date',
    select: 'select',
    relation: 'relation',
    file: 'file',
    json: 'json',
    email: 'email',
    url: 'url',
  };
  return typeMap[type] || 'text';
}

/**
 * Build a PocketBase-compatible field definition.
 */
function buildPBField(field: PocketBaseField): Record<string, any> {
  const pbField: Record<string, any> = {
    name: field.name,
    type: mapFieldType(field.type),
    required: field.required || false,
  };

  // Add type-specific options
  const options: Record<string, any> = {};

  if (field.type === 'select' && field.values) {
    options.values = field.values;
    options.maxSelect = field.maxSelect ?? null; // null = allow multiple
  }

  if (field.type === 'relation' && field.collectionId) {
    options.collectionId = field.collectionId;
    options.maxSelect = field.maxSelect ?? null;
    options.cascadeDelete = field.cascadeDelete || false;
    options.minSelect = null;
  }

  if (field.type === 'number') {
    options.min = null;
    options.max = null;
  }

  if (field.type === 'text') {
    options.min = null;
    options.max = null;
    options.pattern = '';
  }

  if (field.type === 'file') {
    options.maxSelect = 1;
    options.maxSize = 5242880; // 5MB
    options.mimeTypes = [];
    options.thumbs = [];
    options.protected = false;
  }

  if (field.defaultValue !== undefined) {
    pbField.presentable = false;
    options.defaultValue = field.defaultValue;
  }

  if (Object.keys(options).length > 0) {
    pbField.options = options;
  }

  return pbField;
}

/**
 * Create a collection in PocketBase.
 */
async function createCollection(pb: any, schema: PocketBaseSchema): Promise<boolean> {
  const exists = await collectionExists(pb, schema.name);
  if (exists) {
    console.log(`  ⏭️  Collection "${schema.name}" already exists, skipping`);
    return false;
  }

  const fields = schema.fields.map(buildPBField);
  
  // Add required system fields
  const systemFields = [
    { name: 'created', type: 'autodate', options: { onGenerate: 'create' } },
    { name: 'updated', type: 'autodate', options: { onGenerate: 'update' } },
  ];

  try {
    await pb.collections.create({
      name: schema.name,
      type: schema.type,
      schema: [...fields, ...systemFields],
      indexes: schema.indexes || [],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    console.log(`  ✅ Created collection "${schema.name}"`);
    return true;
  } catch (error: any) {
    console.error(`  ❌ Failed to create "${schema.name}": ${error.message}`);
    return false;
  }
}

/**
 * Run the full migration.
 */
export async function runFeatureMigration(): Promise<{ created: number; skipped: number; failed: number }> {
  console.log('\n🚀 Starting Feature Schema Migration\n');
  console.log(`Creating ${ALL_FEATURE_SCHEMAS.length} collections...\n`);

  const pb = getAdminPB();

  // Validate PocketBase connection before proceeding
  try {
    const healthRes = await fetch(`${process.env.NEXT_PUBLIC_PB_URL || 'http://192.168.0.28:8090'}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!healthRes.ok) {
      throw new Error(`PocketBase health check returned ${healthRes.status}`);
    }
    console.log('✅ PocketBase connection verified\n');
  } catch (err: any) {
    throw new Error(
      `Cannot connect to PocketBase: ${err.message}\n` +
      `Check NEXT_PUBLIC_PB_URL (currently: ${process.env.NEXT_PUBLIC_PB_URL || 'http://192.168.0.28:8090'})`
    );
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  // Create collections in order (respecting foreign key dependencies)
  const orderedSchemas = getOrderedSchemas();

  for (const schema of orderedSchemas) {
    const result = await createCollection(pb, schema as PocketBaseSchema);
    if (result === true) created++;
    else if (result === false) skipped++;
    else failed++;
  }

  console.log(`\n📊 Migration complete:`);
  console.log(`   ✅ Created: ${created}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log('');

  return { created, skipped, failed };
}

/**
 * Get schemas in dependency order (referenced collections first).
 */
function getOrderedSchemas(): typeof ALL_FEATURE_SCHEMAS {
  // Define creation order to handle foreign key dependencies
  const order = [
    // Independent collections first
    'skill_branches',
    'achievements',
    'daily_quotes',
    
    // Collections that depend on the above
    'time_capsules',
    'capsule_contents',
    'skill_tree_profiles',
    'quests',
    'user_achievements',
    'money_mountains',
    'mountain_milestones',
    'mountain_transactions',
    'allowance_settings',
    'briefing_preferences',
    'briefing_history',
    'ai_preferences',
    'conversations',
    'conversation_messages',
    'conversation_feedback',
    'proactive_suggestions',
  ];

  const schemaMap = new Map(ALL_FEATURE_SCHEMAS.map(s => [s.name, s]));
  const ordered = [];

  for (const name of order) {
    const schema = schemaMap.get(name);
    if (schema) ordered.push(schema);
  }

  // Add any schemas not in the order list
  for (const schema of ALL_FEATURE_SCHEMAS) {
    if (!ordered.includes(schema)) ordered.push(schema);
  }

  return ordered as unknown as typeof ALL_FEATURE_SCHEMAS;
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

async function main() {
  try {
    const result = await runFeatureMigration();
    
    if (result.failed > 0) {
      process.exit(1);
    }
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

// Only run if executed directly
if (require.main === module) {
  main();
}

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
  /** File fields: byte ceiling. Defaults to 5MB when unset. */
  maxSize?: number;
  /** File fields: accepted MIME types. Empty means "any". */
  mimeTypes?: string[];
}

export interface PocketBaseSchema {
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

/** Outcome of create-or-skip: `failed` must be countable, or a half-created
 *  schema looks like a successful run and the CLI always exits 0. */
type CreateResult = "created" | "skipped" | "failed";

/**
 * Check whether a collection already exists.
 *
 * THREE outcomes, because two are not enough: PocketBase answers a missing
 * collection with a 404, but the probe can also FAIL (network blip, bad auth,
 * PB down). Reading that as "does not exist" would attempt a create straight
 * into an outage — so a failed probe is its own result and the caller counts
 * it as a failure without ever creating blindly.
 */
async function probeCollection(pb: any, name: string): Promise<"exists" | "absent" | "unreachable"> {
  try {
    await pb.collection(name).getList(1, 1);
    return "exists";
  } catch (error: any) {
    if (
      error?.status === 404 ||
      error?.data?.code === 404 ||
      error?.response?.status === 404
    ) {
      return "absent";
    }
    return "unreachable";
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
 * Build a PocketBase-compatible field definition — in the ≥0.23 FLAT shape.
 *
 * The legacy nested `{ name, type, options: {...} }` payload sent under
 * `schema:` is silently IGNORED by modern PocketBase on create: the collection
 * materializes with ONLY its system fields, and any index referencing a schema
 * column then fails with "no such column". (Probed live 2026-10-05: create
 * with `schema:` returned 200 and produced a fields=["id"] collection.)
 * So: flat field props, and only per-type options this PB accepts.
 */
function buildPBField(field: PocketBaseField): Record<string, any> {
  const pbField: Record<string, any> = {
    name: field.name,
    type: mapFieldType(field.type),
    required: field.required || false,
  };
  if (field.type === 'select' && field.values) {
    pbField.values = field.values;
    pbField.maxSelect = field.maxSelect ?? 1;
  }
  if (field.type === 'relation' && field.collectionId) {
    pbField.collectionId = field.collectionId;
    pbField.maxSelect = field.maxSelect ?? 1;
    pbField.cascadeDelete = field.cascadeDelete || false;
  }
  if (field.type === 'file') {
    pbField.maxSelect = 1;
    pbField.maxSize = field.maxSize ?? 5242880; // 5MB unless the schema says otherwise
    pbField.mimeTypes = field.mimeTypes ?? [];
    pbField.thumbs = [];
    pbField.protected = false;
  }
  return pbField;
}

/**
 * Create a collection in PocketBase — or report why it was not created.
 */
async function createCollection(pb: any, schema: PocketBaseSchema): Promise<CreateResult> {
  const probe = await probeCollection(pb, schema.name);
  if (probe === "exists") {
    console.log(`  ⏭️  Collection "${schema.name}" already exists, skipping`);
    return "skipped";
  }
  if (probe === "unreachable") {
    console.error(
      `  ❌ Cannot confirm whether "${schema.name}" exists — PocketBase probe failed, not attempting create`,
    );
    return "failed";
  }

  const fields = schema.fields.map(buildPBField);

  // No hand-rolled `created`/`updated` autodates: modern PocketBase adds the
  // system fields (id/created/updated) itself, and adding our own both is a
  // name conflict and was part of the legacy `schema:` payload this PB ignores.
  try {
    await pb.collections.create({
      name: schema.name,
      type: schema.type,
      fields,
      indexes: schema.indexes || [],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    console.log(`  ✅ Created collection "${schema.name}"`);
    return "created";
  } catch (error: any) {
    // Field-level validation detail lives in error.data.data on this PB —
    // without it every failure prints the identical "Failed to create collection."
    const detail = error?.data?.data ? ` — ${JSON.stringify(error.data.data).slice(0, 300)}` : "";
    console.error(`  ❌ Failed to create "${schema.name}": ${error.message}${detail}`);
    return "failed";
  }
}

/**
 * Heal `maxSize` drift on a collection that ALREADY exists (spec §6.1).
 *
 * Editing a schema file changes nothing on a live database — `createCollection`
 * skips existing collections, so a bumped file ceiling never reaches PocketBase
 * and the API keeps rejecting at its own layer. This pass compares each `file`
 * field's live `maxSize` with the schema's and writes back only what drifted.
 *
 * PocketBase moved file options from `field.options.maxSize` (nested, <0.23) to
 * `field.maxSize` (flat, ≥0.23), so both shapes are read — and each field is
 * written back in the shape it was read in. Returns the number of fields healed.
 */
export async function reconcileFileFieldLimits(pb: any, schema: PocketBaseSchema): Promise<number> {
  const wanted = new Map<string, number>(
    schema.fields
      .filter((field) => field.type === 'file' && typeof field.maxSize === 'number')
      .map((field) => [field.name, field.maxSize as number]),
  );
  if (wanted.size === 0) return 0;

  const live = await pb.collections.getOne(schema.name);
  const source: any = live ?? {};
  // Same version split one level up: ≥0.23 serves `fields`, older serves `schema`.
  const legacyShape = !Array.isArray(source.fields) && Array.isArray(source.schema);
  const liveFields: any[] = legacyShape
    ? source.schema
    : Array.isArray(source.fields)
      ? source.fields
      : [];
  if (liveFields.length === 0) return 0;

  let healed = 0;
  const updated = liveFields.map((field) => {
    const wantedMax = wanted.get(field.name);
    if (wantedMax === undefined || field.type !== 'file') return field;
    const readFlat = typeof field.maxSize === 'number';
    const current = readFlat ? field.maxSize : field.options?.maxSize;
    if (current === wantedMax) return field;
    healed++;
    console.log(`  🔧 ${schema.name}.${field.name}: ${current ?? '(unset)'} -> ${wantedMax}`);
    // `unset` on both counts as flat: a modern field with no options at all
    // must not grow a nested `options` block it never had.
    return readFlat || current === undefined
      ? { ...field, maxSize: wantedMax }
      : { ...field, options: { ...field.options, maxSize: wantedMax } };
  });

  if (healed === 0) return 0;
  await pb.collections.update(
    String(source.id ?? schema.name),
    legacyShape ? { schema: updated } : { fields: updated },
  );
  console.log(`  ✅ ${schema.name}: healed ${healed} file field limit(s)`);
  return healed;
}

/**
 * Heal `mimeTypes` drift on a collection that ALREADY exists — the sibling of
 * {@link reconcileFileFieldLimits}. Adding an accepted format to a schema file
 * changes nothing on a live database (`createCollection` skips existing
 * collections), so the accepted-type list is written back in the shape it was
 * read (PB <0.23 nested `options`, ≥0.23 flat).
 *
 * A field that does not express the option at all is left alone: an absent
 * `mimeTypes` means "allow all" in PocketBase, and inventing an options block
 * the field never had is a shape change this pass has no business making.
 * Returns the number of fields healed.
 */
export async function reconcileFileFieldMimeTypes(pb: any, schema: PocketBaseSchema): Promise<number> {
  const wanted = new Map<string, string[]>(
    schema.fields
      .filter((field) => field.type === 'file' && Array.isArray(field.mimeTypes))
      .map((field) => [field.name, field.mimeTypes as string[]]),
  );
  if (wanted.size === 0) return 0;

  const live = await pb.collections.getOne(schema.name);
  const source: any = live ?? {};
  const legacyShape = !Array.isArray(source.fields) && Array.isArray(source.schema);
  const liveFields: any[] = legacyShape
    ? source.schema
    : Array.isArray(source.fields)
      ? source.fields
      : [];
  if (liveFields.length === 0) return 0;

  const sameList = (a: unknown, b: string[]) =>
    Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

  let healed = 0;
  const updated = liveFields.map((field) => {
    const wantedMimes = wanted.get(field.name);
    if (!wantedMimes || field.type !== 'file') return field;
    const readFlat = Array.isArray(field.mimeTypes);
    const current = readFlat ? field.mimeTypes : field.options?.mimeTypes;
    if (!Array.isArray(current)) return field; // option absent — leave the shape alone
    if (sameList(current, wantedMimes)) return field;
    healed++;
    console.log(
      `  🔧 ${schema.name}.${field.name}: mimeTypes [${current.join(', ')}] -> [${wantedMimes.join(', ')}]`,
    );
    return readFlat
      ? { ...field, mimeTypes: wantedMimes }
      : { ...field, options: { ...field.options, mimeTypes: wantedMimes } };
  });

  if (healed === 0) return 0;
  await pb.collections.update(
    String(source.id ?? schema.name),
    legacyShape ? { schema: updated } : { fields: updated },
  );
  console.log(`  ✅ ${schema.name}: healed ${healed} file field mime list(s)`);
  return healed;
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

  // The migration reads and writes collection schemas, which are locked to a
  // superuser. pb.seed.mjs does this explicitly; this script historically did
  // NOT (the feature schemas were only ever unit-tested against fakes), so
  // every create/probe failed with "requires valid record authorization".
  const adminEmail = process.env.PB_ADMIN_EMAIL;
  const adminPass = process.env.PB_ADMIN_PASS;
  if (!adminEmail || !adminPass) {
    throw new Error('PB_ADMIN_EMAIL and PB_ADMIN_PASS are required (run via `npm run migrate:features`; values load from .env.local)');
  }
  await pb.collection('_superusers').authWithPassword(adminEmail, adminPass);

  let created = 0;
  let skipped = 0;
  let failed = 0;
  let healed = 0;

  // Create collections in order (respecting foreign key dependencies)
  const orderedSchemas = getOrderedSchemas();

  for (const schema of orderedSchemas) {
    const typed = schema as PocketBaseSchema;
    const result = await createCollection(pb, typed);
    if (result === "created") created++;
    else if (result === "skipped") skipped++;
    else failed++;

    // "Already there" is not "already right": a bumped field option never
    // reaches an existing collection through create, so patch the drift here.
    if (result === "skipped") {
      try {
        healed += await reconcileFileFieldLimits(pb, typed);
        healed += await reconcileFileFieldMimeTypes(pb, typed);
      } catch (error: any) {
        // Not folded into `failed` (that tally counts collections): the create
        // result stands, but a reconcile that did not land is shouted about.
        console.error(
          `[migrate] reconcile failed for "${typed.name}": ${error?.message ?? error}`,
        );
      }
    }
  }

  console.log(`\n📊 Migration complete:`);
  console.log(`   ✅ Created: ${created}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Failed: ${failed}`);
  if (healed > 0) console.log(`   🔧 File field options healed: ${healed}`);
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

    // Photos has no foreign-key dependencies, but it is listed explicitly so
    // the creation order stays deterministic.
    'photos',
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
    // Real credentials live in .env.local (gitignored) — load like pb-seed.mjs does.
    // Node's loadEnvFile never overrides keys already present in the environment.
    try {
      (process as any).loadEnvFile?.('.env.local');
    } catch {
      /* fine — the vars may already be in the environment */
    }
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

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

import { COLLECTIONS, collectionFieldsForSeed } from "@/lib/pb-seed";
import type { PbCollectionContract, PbSchemaFieldContract } from "@/lib/pb-seed";

export const TERMINAL_MIGRATION_FILE = "1790250000_terminal_locked_task_schema.js";

export const TERMINAL_PARITY_COLLECTIONS = [
  "members",
  "tasks",
  "consuela_data_snapshots",
  "week_data",
  "week_archive",
  "rewards",
  "penalties",
  "hall_of_fame",
  "chat_messages",
  "morning_briefing",
  "proactive_suggestions",
  "consuela_state",
] as const;

const MIGRATIONS_DIR = resolve(__dirname, "../../../pb_migrations");
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, TERMINAL_MIGRATION_FILE);
const RULE_NAMES = [
  "listRule",
  "viewRule",
  "createRule",
  "updateRule",
  "deleteRule",
] as const;
const OPTION_KEYS = ["min", "max", "maxSelect", "onCreate", "onUpdate"] as const;

type TerminalField = {
  name?: unknown;
  type?: unknown;
  required?: unknown;
  options?: unknown;
  max?: unknown;
  maxSelect?: unknown;
  values?: unknown;
  onCreate?: unknown;
  onUpdate?: unknown;
};

type TerminalCollection = Record<string, unknown>;

type TerminalSchema = Record<string, TerminalCollection>;

function contractFor(name: string): PbCollectionContract {
  const contract = COLLECTIONS.find((entry) => entry.name === name);
  if (!contract) {
    throw new Error(`src/lib/pb-seed.ts declares no contract for ${name}`);
  }
  return contract;
}

function normalizedOptions(
  options: PbSchemaFieldContract["options"] | undefined
): Record<string, unknown> {
  const source = (options ?? {}) as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of OPTION_KEYS) {
    if (source[key] !== undefined) normalized[key] = source[key];
  }
  const values = source.values;
  if (Array.isArray(values)) {
    normalized.values = values.map((value) => String(value)).sort();
  }
  return normalized;
}

function normalizedTerminalOptions(options: unknown): Record<string, unknown> {
  if (options === undefined || options === null) return {};
  if (typeof options !== "object") {
    throw new Error(`TERMINAL_SCHEMA field options must be an object, got ${typeof options}`);
  }
  return normalizedOptions(options as PbSchemaFieldContract["options"]);
}

function normalizedIndexSql(sql: unknown): string {
  if (typeof sql !== "string") {
    throw new Error(`TERMINAL_SCHEMA index entries must be SQL strings, got ${typeof sql}`);
  }
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function terminalFields(collection: TerminalCollection, name: string): TerminalField[] {
  const fields = collection.schema;
  if (!Array.isArray(fields)) {
    throw new Error(
      `${TERMINAL_MIGRATION_FILE} must declare ${name}.schema as an array of field definitions`
    );
  }
  return fields as TerminalField[];
}

function loadTerminalSchema(): TerminalSchema {
  if (!existsSync(MIGRATION_PATH)) {
    throw new Error(
      `${TERMINAL_MIGRATION_FILE} does not exist in pb_migrations — the terminal locked task schema migration is required`
    );
  }
  const source = readFileSync(MIGRATION_PATH, "utf8");
  const sandbox: Record<string, unknown> = {
    migrate: () => undefined,
    unmarshal: () => undefined,
    Collection: (definition: unknown) => structuredClone(definition),
    Field: (definition: unknown) => structuredClone(definition),
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: MIGRATION_PATH, timeout: 15_000 });
  const schema = sandbox.TERMINAL_SCHEMA;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(
      `${TERMINAL_MIGRATION_FILE} must declare a top-level var TERMINAL_SCHEMA object so the declared contract can be read without running the migration`
    );
  }
  return schema as TerminalSchema;
}

describe("terminal migration schema parity", () => {
  it("declares the terminal migration file in pb_migrations", () => {
    expect(
      existsSync(MIGRATION_PATH),
      `${TERMINAL_MIGRATION_FILE} is missing from ${MIGRATIONS_DIR}`
    ).toBe(true);
  });

  it("covers every parity collection in the seed contract", () => {
    const contractNames = new Set(COLLECTIONS.map((entry) => entry.name));
    for (const name of TERMINAL_PARITY_COLLECTIONS) {
      expect(contractNames.has(name), `${name} must exist in COLLECTIONS`).toBe(true);
    }
  });

  it("declares TERMINAL_SCHEMA for every parity collection", () => {
    const schema = loadTerminalSchema();
    for (const name of TERMINAL_PARITY_COLLECTIONS) {
      const declared = schema[name];
      expect(declared, `${name} must be declared in TERMINAL_SCHEMA`).toBeTypeOf("object");
    }
  });

  it.each(TERMINAL_PARITY_COLLECTIONS)(
    "locks all five API rules to null on %s",
    (name) => {
      const declared = loadTerminalSchema()[name] as TerminalCollection;
      for (const rule of RULE_NAMES) {
        expect(declared[rule], `${name}.${rule} must be null`).toBeNull();
      }
    }
  );

  it.each(TERMINAL_PARITY_COLLECTIONS)(
    "declares exactly the seed field contract for %s",
    (name) => {
      const contract = contractFor(name);
      const expected = collectionFieldsForSeed(contract);
      const declared = terminalFields(loadTerminalSchema()[name], name);

      const declaredNames = declared.map((field) => String(field.name));
      expect(
        [...declaredNames].sort(),
        `${name} must declare exactly the seed fields — no extra field (id/autodate included), none missing`
      ).toEqual(expected.map((field) => field.name).sort());
      expect(
        new Set(declaredNames).size,
        `${name} must not declare a field twice`
      ).toBe(declaredNames.length);

      for (const contractField of expected) {
        const declaredField = declared.find(
          (field) => String(field.name) === contractField.name
        );
        const label = `${name}.${contractField.name}`;
        expect(declaredField, `${label} must be declared`).toBeDefined();
        expect(
          String(declaredField!.type),
          `${label} type must be ${contractField.type}`
        ).toBe(contractField.type);
        if (contractField.required !== undefined) {
          expect(
            typeof declaredField!.required,
            `${label} required must be a boolean`
          ).toBe("boolean");
        }
        expect(
          Boolean(declaredField!.required),
          `${label} must be ${contractField.required ? "required" : "optional"}`
        ).toBe(Boolean(contractField.required));
        expect(
          normalizedTerminalOptions(declaredField!.options),
          `${label} options must match the seed contract`
        ).toEqual(normalizedOptions(contractField.options));
      }
    }
  );

  it.each(TERMINAL_PARITY_COLLECTIONS)(
    "declares exactly the seed index contract for %s",
    (name) => {
      const contract = contractFor(name);
      const declared = loadTerminalSchema()[name].indexes;
      expect(Array.isArray(declared), `${name}.indexes must be an array`).toBe(true);
      const declaredSql = (declared as unknown[]).map(normalizedIndexSql);
      expect(
        declaredSql.slice().sort(),
        `${name} must declare exactly the seed index statements`
      ).toEqual((contract.indexes ?? []).map(normalizedIndexSql).sort());
    }
  );

  it("declares every top-level binding exactly once", () => {
    const source = readFileSync(MIGRATION_PATH, "utf8");
    const bindings = [...source.matchAll(/^(?:var\s+)?(\w+)\s*=/gm)].map(
      (match) => match[1]
    );
    const duplicates = bindings.filter(
      (name, index) => bindings.indexOf(name) !== index
    );
    expect(
      [...new Set(duplicates)],
      "each top-level binding in the terminal migration must be declared exactly once — a duplicated literal is dead weight that can silently diverge from its copy"
    ).toEqual([]);
    expect(
      bindings.slice().sort(),
      "the terminal migration must declare only the schema and the down-function field map at top level"
    ).toEqual(["TERMINAL_ADDED_FIELDS", "TERMINAL_SCHEMA"]);
  });

  it("runs a single migrate call", () => {
    const source = readFileSync(MIGRATION_PATH, "utf8");
    const calls = [...source.matchAll(/\bmigrate\s*\(/g)].length;
    expect(calls, "the terminal migration must register exactly one up/down pair").toBe(1);
  });

  it.each(TERMINAL_PARITY_COLLECTIONS)(
    "declares the top-level field keys PocketBase 0.39.11 actually honours for %s",
    (name) => {
      const declared = terminalFields(loadTerminalSchema()[name], name);
      for (const field of declared) {
        const options = ((field.options ?? {}) as Record<string, unknown>);
        const label = `${name}.${String(field.name)}`;
        if (typeof options.max === "number") {
          expect(
            field.max,
            `${label} must repeat max at the top level — PocketBase 0.39.11 ignores options and would silently store max 0`
          ).toBe(options.max);
        }
        if (typeof options.maxSelect === "number") {
          expect(
            field.maxSelect,
            `${label} must repeat maxSelect at the top level`
          ).toBe(options.maxSelect);
        }
        if (Array.isArray(options.values)) {
          expect(
            (Array.isArray(field.values) ? field.values : []).map((value) => String(value)).sort(),
            `${label} must repeat its select values at the top level — PocketBase 0.39.11 rejects a select with no top-level values`
          ).toEqual(options.values.map((value) => String(value)).sort());
        }
        if (String(field.type) === "autodate") {
          expect(
            field.onCreate,
            `${label} must set top-level onCreate — options alone is rejected`
          ).toBe(true);
          expect(
            Boolean(field.onUpdate),
            `${label} top-level onUpdate must mirror the seed contract`
          ).toBe(options.onUpdate === true);
        }
      }
    }
  );
});

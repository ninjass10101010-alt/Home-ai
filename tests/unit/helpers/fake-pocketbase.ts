/**
 * A faithful fake PocketBase for the family-memory store.
 *
 * Two fakes that behave differently is how a defect stays invisible, so
 * this one is shared by every suite that talks to the memory bank. Its
 * behaviour was measured against PocketBase 0.40.5 with a throwaway
 * database (the probe lives outside the repo):
 *
 *   - a filter naming a column the collection does NOT declare is a 400;
 *   - a write carrying a field the collection does NOT declare SUCCEEDS
 *     (200) and the unknown field is DROPPED — so on the pre-Task-3 schema
 *     a correction destroys the previous wording;
 *   - a record read returns a FRESH object every time (it is JSON over the
 *     wire), so a read-modify-write race is real;
 *   - an unset text field reads back as "", an unset number as 0 and an
 *     unset json as null — and a column that does not exist is OMITTED
 *     from the record entirely;
 *   - a duplicate (userId, key) is a 400 "validation_not_unique".
 */

export type ColumnType = "text" | "number" | "json";

/** The collection as it is AFTER the Task-3 schema change. */
export const NEW_SCHEMA: Record<string, ColumnType> = {
  id: "text", userId: "text", familyId: "text", category: "text", key: "text", content: "text",
  tags: "text", confidence: "number", usageCount: "number", lastUsed: "text", createdAt: "text",
  updatedAt: "text", person: "text", scope: "text", status: "text", version: "number",
  history: "json", source: "text",
};

/** The collection BEFORE it — the world a deploy between Task 2 and Task 3
 *  would run in. */
export const OLD_SCHEMA: Record<string, ColumnType> = {
  id: "text", userId: "text", familyId: "text", category: "text", key: "text", content: "text",
  tags: "text", confidence: "number", usageCount: "number", lastUsed: "text", createdAt: "text",
  updatedAt: "text",
};

export interface FakePbCall {
  method: string;
  args: any[];
}

export interface FakePbState {
  rows: any[];
  schema: Record<string, ColumnType>;
  calls: FakePbCall[];
  failRead: boolean;
  failWrite: boolean;
}

export function createFakePbState(): FakePbState {
  return {
    rows: [],
    schema: { ...NEW_SCHEMA },
    calls: [],
    failRead: false,
    failWrite: false,
  };
}

/** A PocketBase-shaped error: the SDK throws a ClientResponseError with a
 *  status and the parsed body. */
export function pbError(status: number, message: string, data: any = {}): Error {
  const err: any = new Error(message);
  err.name = `ClientResponseError ${status}`;
  err.status = status;
  err.response = { code: status, message, data };
  return err;
}

function parseEquals(filter: string): Array<[string, string]> {
  return [...filter.matchAll(/([A-Za-z_]+) = "([^"]*)"/g)].map((m) => [m[1], m[2]] as [string, string]);
}
function parseNotEquals(filter: string): Array<[string, string]> {
  return [...filter.matchAll(/([A-Za-z_]+) != "([^"]*)"/g)].map((m) => [m[1], m[2]] as [string, string]);
}
function parseLikes(filter: string): Array<[string, string]> {
  return [...filter.matchAll(/([A-Za-z_]+) ~ "([^"]*)"/g)].map((m) => [m[1], m[2].toLowerCase()] as [string, string]);
}

/** The columns the filter names. A column the collection does not declare is
 *  a 400 in real PocketBase — that is the whole reason the store cannot put
 *  `status != "archived"` in the filter before Task 3 lands. */
function assertFilterColumns(filter: string, schema: Record<string, ColumnType>): void {
  const named = [
    ...parseEquals(filter).map(([f]) => f),
    ...parseNotEquals(filter).map(([f]) => f),
    ...parseLikes(filter).map(([f]) => f),
  ];
  for (const field of named) {
    if (!(field in schema)) {
      throw pbError(400, "Something went wrong while processing your request.");
    }
  }
}

/** The equality conditions are ANDed; the LIKE clauses are ORed — the same
 *  shape `buildMemoryFilter` produces. A LIKE is a byte-wise substring match
 *  that folds ASCII case and nothing else. */
function matches(row: any, filter: string): boolean {
  for (const [field, value] of parseEquals(filter)) {
    if (String(row[field] ?? "") !== value) return false;
  }
  for (const [field, value] of parseNotEquals(filter)) {
    if (String(row[field] ?? "") === value) return false;
  }
  const likes = parseLikes(filter);
  if (likes.length && !likes.some(([field, term]) => String(row[field] ?? "").toLowerCase().includes(term))) {
    return false;
  }
  return true;
}

/** PocketBase's sort string: "-field" descending, "field" ascending, comma
 *  separated. */
function sortRows(list: any[], sort?: string): any[] {
  if (!sort) return list;
  const clauses = sort.split(",").map((part) => {
    const desc = part.trim().startsWith("-");
    return { field: part.trim().replace(/^-/, ""), desc };
  });
  return [...list].sort((a, b) => {
    for (const { field, desc } of clauses) {
      const left = a[field];
      const right = b[field];
      if (left === right) continue;
      if (left === undefined || left === null) return 1;
      if (right === undefined || right === null) return -1;
      const cmp = left < right ? -1 : 1;
      return desc ? -cmp : cmp;
    }
    return 0;
  });
}

/** The zero value PocketBase returns for an unset field. */
function zeroValue(type: ColumnType): any {
  if (type === "number") return 0;
  if (type === "json") return null;
  return "";
}

/** A row as PocketBase returns it: the declared columns only, the unset ones
 *  at their zero value, and a FRESH object every read. */
function present(state: FakePbState, row: any): any {
  const out: any = {};
  for (const [field, type] of Object.entries(state.schema)) {
    out[field] = field in row ? row[field] : zeroValue(type);
  }
  return out;
}

/** A write carries only the fields the collection declares — the others are
 *  DROPPED, silently, with a 200. */
function keepDeclared(state: FakePbState, data: any): any {
  const out: any = {};
  for (const [field, value] of Object.entries(data)) {
    if (field in state.schema) out[field] = value;
  }
  return out;
}

export function createFakePb(state: FakePbState) {
  return {
    collection: () => ({
      getList: async (page: number, perPage: number, opts: any = {}) => {
        state.calls.push({ method: "getList", args: [page, perPage, opts] });
        if (state.failRead) throw pbError(500, "Failed to connect to the PocketBase server.");
        const filter = opts.filter ?? "";
        if (filter) assertFilterColumns(filter, state.schema);
        const matched = sortRows(state.rows.filter((r) => !filter || matches(r, filter)), opts.sort);
        const start = (page - 1) * perPage;
        const items = matched.slice(start, start + perPage).map((r) => {
          const row = present(state, r);
          if (opts.fields) {
            const wanted = opts.fields.split(",").map((f: string) => f.trim());
            const projected: any = {};
            for (const field of wanted) if (field in row) projected[field] = row[field];
            return projected;
          }
          return row;
        });
        return { page, perPage, totalItems: matched.length, totalPages: 1, items };
      },
      getFullList: async (opts: any = {}) => {
        state.calls.push({ method: "getFullList", args: [opts] });
        if (state.failRead) throw pbError(500, "Failed to connect to the PocketBase server.");
        const filter = opts.filter ?? "";
        if (filter) assertFilterColumns(filter, state.schema);
        return sortRows(state.rows.filter((r) => !filter || matches(r, filter)), opts.sort)
          .map((r) => present(state, r));
      },
      getFirstListItem: async (filter: string) => {
        state.calls.push({ method: "getFirstListItem", args: [filter] });
        if (state.failRead) throw pbError(500, "Failed to connect to the PocketBase server.");
        if (filter) assertFilterColumns(filter, state.schema);
        const row = state.rows.find((r) => matches(r, filter));
        if (!row) throw pbError(404, "The requested resource wasn't found.");
        return present(state, row);
      },
      create: async (data: any) => {
        state.calls.push({ method: "create", args: [data] });
        if (state.failWrite) throw pbError(500, "Failed to create record.");
        const payload = keepDeclared(state, data);
        if (state.rows.some((r) => r.userId === payload.userId && r.key === payload.key)) {
          throw pbError(400, "Failed to create record.", { key: { code: "validation_not_unique" } });
        }
        const row = { id: `r${state.rows.length + 1}`, ...payload };
        state.rows.push(row);
        return present(state, row);
      },
      update: async (id: string, data: any) => {
        state.calls.push({ method: "update", args: [id, data] });
        if (state.failWrite) throw pbError(500, "Failed to update record.");
        const row = state.rows.find((r) => r.id === id);
        if (!row) throw pbError(404, "The requested resource wasn't found.");
        Object.assign(row, keepDeclared(state, data));
        return present(state, row);
      },
      getOne: async (id: string) => {
        const row = state.rows.find((r) => r.id === id);
        if (!row) throw pbError(404, "The requested resource wasn't found.");
        return present(state, row);
      },
      delete: async (id: string) => {
        const i = state.rows.findIndex((r) => r.id === id);
        if (i >= 0) state.rows.splice(i, 1);
      },
    }),
  };
}

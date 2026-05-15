/**
 * Database abstraction layer over PocketBase
 */
import PocketBase from "pocketbase";

const pbUrl = process.env.NEXT_PUBLIC_PB_URL || "http://192.168.0.27:8090";
const pb = new PocketBase(pbUrl);
pb.autoCancellation(false);

// ─── QueryBuilder: Drizzle-style chainable queries ───

class QueryBuilder {
  private _collection = "";
  private _filter = "";

  constructor(private resultType?: "list" | "one" | "first") {}

  from(collection?: string) {
    if (collection) this._collection = collection;
    return this;
  }

  where(filter?: string) {
    if (filter) this._filter = filter;
    return this;
  }

  async execute<T = any>(): Promise<T[]> {
    try {
      const records = await pb.collection(this._collection).getFullList({
        filter: this._filter || undefined,
      });
      return records as T[];
    } catch {
      return [];
    }
  }
}

// ─── Drizzle-style db object ───

const db = {
  select: (fields?: string) => new QueryBuilder("list"),
};

// ─── Extras needed by the app ───

export function getMembersForCalendarSync(): {
  name: string;
  emoji: string;
}[] {
  // Returns hardcoded family members; real data comes via chat/LLM per product design
  return [
    { name: "Mom", emoji: "👩" },
    { name: "Dad", emoji: "👨" },
    { name: "Jake", emoji: "👦" },
    { name: "Lily", emoji: "👧" },
  ];
}

export { QueryBuilder, db };
export default db;

import { runMigrations } from "@kilocode/app-builder-db";
import { db } from "./index";

await runMigrations(db as any, {}, { migrationsFolder: "./src/db/migrations" });
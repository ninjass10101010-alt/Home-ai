import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The API reference is read from disk on every request so an operator can edit
// docs/muse-api.md and have the change live immediately. Public by design — it
// documents the wire protocol and contains no family data.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOCS_PATH = () => join(process.cwd(), "docs/muse-api.md");

export async function GET() {
  try {
    const body = await readFile(DOCS_PATH(), "utf8");
    return new NextResponse(body, {
      status: 200,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  } catch (err) {
    console.error("[muse/docs] failed to read docs/muse-api.md:", err);
    return NextResponse.json(
      { error: "docs_unavailable", message: "docs/muse-api.md could not be read" },
      { status: 500 }
    );
  }
}

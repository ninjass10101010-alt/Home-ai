import { NextRequest, NextResponse } from "next/server";
import { searchMeals } from "@/lib/themealdb";

export const dynamic = "force-dynamic";

const MAX_QUERY_LENGTH = 60;

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") || "").trim();
  if (!query) {
    return NextResponse.json({ error: "Enter a search term first." }, { status: 400 });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: `Keep the search under ${MAX_QUERY_LENGTH} characters.` }, { status: 400 });
  }

  try {
    const results = await searchMeals(query);
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error && err.name === "AbortError"
      ? "TheMealDB took too long to answer. Try again in a moment."
      : "Couldn't reach TheMealDB right now. Check your connection and try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

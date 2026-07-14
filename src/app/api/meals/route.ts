import { NextResponse } from "next/server";
import { pbQuery, pbCreate, pbUpdate, pbDelete } from "@/lib/pb";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId") || "demo";
    const params: Record<string, any> = { sort: "-id", perPage: 200, filter: `userId='${userId}'` };
    const result = await pbQuery("meal_plan_entries", params);
    return NextResponse.json({ meals: result.items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.userId) body.userId = "demo";
    const record = await pbCreate("meal_plan_entries", body);
    return NextResponse.json({ meal: record }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { id, ...data } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const record = await pbUpdate("meal_plan_entries", id, data);
    return NextResponse.json({ meal: record });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await pbDelete("meal_plan_entries", id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

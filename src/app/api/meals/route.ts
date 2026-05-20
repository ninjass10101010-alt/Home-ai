import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const allMeals: Array<Record<string, unknown>> = [];
    return NextResponse.json(allMeals);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch meals' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ id: Date.now(), ...body }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create meal' }, { status: 500 });
  }
}

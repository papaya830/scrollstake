import { NextResponse } from "next/server";
import { getSession } from "@/lib/store";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await getSession(code);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  return NextResponse.json(session);
}

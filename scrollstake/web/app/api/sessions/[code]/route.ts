import { NextResponse } from "next/server";
import { getSession, PersistentStoreUnavailableError } from "@/lib/store";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  try {
    const session = await getSession(code);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    return NextResponse.json(session);
  } catch (error) {
    if (error instanceof PersistentStoreUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
}

import { NextResponse } from "next/server";
import { issueApprovedToken } from "@/lib/store";

export async function POST(_req: Request, { params }: { params: Promise<{ code: string; wallet: string }> }) {
  const { code, wallet } = await params;
  const clientToken = await issueApprovedToken(code, wallet);
  return clientToken ? NextResponse.json({ clientToken, membershipStatus: "approved" }) : NextResponse.json({ error: "member is not approved" }, { status: 403 });
}

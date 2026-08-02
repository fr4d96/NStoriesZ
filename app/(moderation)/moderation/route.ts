import { NextResponse } from "next/server";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";

// Real role check as of Prompt 2 (role model now exists), still fails
// closed to a flat 404 for anyone without the moderator/admin role — see
// app/(editor)/editorial/route.ts for why this stays a Route Handler rather
// than a page. No nav entry links here yet; the actual moderation queue
// lands in Prompt 7.
export async function GET() {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["moderator", "admin"]);

  if (!access.ok) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    role: access.role,
    message: "Moderation queue is not built yet (Prompt 7).",
  });
}

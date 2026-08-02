import { NextResponse } from "next/server";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";

// Real role check as of Prompt 2 (role model now exists), still fails
// closed to a flat 404 for anyone without the editor/admin role — same
// rationale as Prompt 1 for using a Route Handler rather than a page: a
// page-based notFound() can flush as HTTP 200 before the 404 attaches
// (verified via curl in Prompt 1). No nav entry links here yet; the actual
// import/editorial UI lands in Prompt 7.
export async function GET() {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["editor", "admin"]);

  if (!access.ok) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    role: access.role,
    message: "Editorial import workflow is not built yet (Prompt 7).",
  });
}

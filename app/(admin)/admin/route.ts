import { NextResponse } from "next/server";

// Fails closed until a real role model exists (Prompt 2+). No nav entry
// links here. A Route Handler rather than a page component, so the 404
// status is set directly instead of depending on App Router streaming to
// propagate notFound() before the response has already flushed as 200.
export function GET() {
  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

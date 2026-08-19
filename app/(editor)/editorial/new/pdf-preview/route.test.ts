// @vitest-environment node
//
// server-only's package code throws unconditionally outside Next's own
// bundler -- same reasoning/mock as lib/story/pdf-import.test.ts and
// lib/story/pdf-page-attachment.test.ts. This exercises Phase A of Stage 4
// (docs/pdf-canva-import-plan.md) as a real Route Handler: constructs an
// actual multipart NextRequest and calls the exported POST() directly,
// rather than testing renderPagePreviews() again (already covered by
// lib/story/pdf-import.test.ts) -- this test is about the wiring (auth,
// multipart parsing, response shape), not re-proving the renderer.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null;
let currentRole: "user" | "editor" | "moderator" | "admin" | null;

beforeEach(() => {
  currentUser = { id: "editor-1" };
  currentRole = "editor";
});

vi.mock("@/lib/auth/get-current-user", () => ({
  getCurrentUser: async () => currentUser,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table !== "user_roles") throw new Error(`Unmocked table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            single: async () =>
              currentRole
                ? { data: { role: currentRole }, error: null }
                : { data: null, error: new Error("not found") },
          }),
        }),
      };
    },
  }),
}));

// Resolved from the project root (vitest's cwd), not __dirname, since this
// test file lives several route-group directories deep and counting ".."
// segments through a `(group)` path is easy to get wrong silently.
const FIXTURES_DIR = path.join(process.cwd(), "lib", "story", "__fixtures__");
async function fixture(name: string): Promise<Buffer> {
  return readFile(path.join(FIXTURES_DIR, name));
}

function requestWithFile(bytes: Buffer, filename = "test.pdf"): NextRequest {
  const formData = new FormData();
  formData.append(
    "file",
    new File([new Uint8Array(bytes)], filename, { type: "application/pdf" }),
  );
  return new NextRequest("http://localhost/editorial/new/pdf-preview", {
    method: "POST",
    body: formData,
  });
}

describe("POST /editorial/new/pdf-preview", () => {
  it("rejects a signed-out / non-editorial-role caller before touching the file", async () => {
    currentRole = "user";
    const { POST } = await import("./route");
    const bytes = await fixture("valid-two-page.pdf");
    const response = await POST(requestWithFile(bytes));

    expect(response.status).toBe(403);
  });

  it("returns preview thumbnails + page numbers for a valid PDF, without creating anything", async () => {
    const { POST } = await import("./route");
    const bytes = await fixture("valid-two-page.pdf");
    const response = await POST(requestWithFile(bytes));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pageCount).toBe(2);
    expect(body.pages).toHaveLength(2);
    expect(body.pages.map((p: { pageNumber: number }) => p.pageNumber)).toEqual(
      [1, 2],
    );
    for (const page of body.pages) {
      expect(page.dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(page.width).toBeGreaterThan(0);
      expect(page.height).toBeGreaterThan(0);
    }
  });

  it("rejects a non-PDF file with a clear error, not a crash", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      requestWithFile(Buffer.from("not a pdf at all"), "fake.pdf"),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  it("rejects a password-protected PDF", async () => {
    const { POST } = await import("./route");
    const bytes = await fixture("password-protected.pdf");
    const response = await POST(requestWithFile(bytes));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/password/i);
  });

  it("rejects a request with no file", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/editorial/new/pdf-preview", {
        method: "POST",
        body: new FormData(),
      }),
    );

    expect(response.status).toBe(400);
  });
});

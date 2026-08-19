// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PdfImportPicker } from "./pdf-import-picker";
import type { ContributorForEditorial } from "@/lib/story/editorial-queries";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const CONTRIBUTORS: ContributorForEditorial[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Alex Tan",
    publicStatus: "approved",
    attributionType: "display_name",
    isLinked: true,
  } as ContributorForEditorial,
];

const PREVIEW_RESPONSE = {
  pageCount: 3,
  pages: [
    {
      pageNumber: 1,
      width: 100,
      height: 140,
      dataUrl: "data:image/png;base64,AAA",
    },
    {
      pageNumber: 2,
      width: 100,
      height: 140,
      dataUrl: "data:image/png;base64,BBB",
    },
    {
      pageNumber: 3,
      width: 100,
      height: 140,
      dataUrl: "data:image/png;base64,CCC",
    },
  ],
};

function pdfFile(name = "trip.pdf") {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
  const file = new File([bytes], name, { type: "application/pdf" });
  // jsdom's File#slice/arrayBuffer works off the actual bytes given above,
  // so the component's client-side magic-byte sniff sees a real "%PDF-"
  // header without needing to stub File methods.
  return file;
}

async function uploadAndPreview(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByLabelText("PDF file") as HTMLInputElement;
  await user.upload(input, pdfFile());
  await user.click(
    screen.getByRole("button", { name: "Upload & preview pages" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Select pages to attach")).toBeInTheDocument(),
  );
}

beforeEach(() => {
  push.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/editorial/new/pdf-preview") {
        return new Response(JSON.stringify(PREVIEW_RESPONSE), { status: 200 });
      }
      if (url === "/editorial/new/pdf-attach") {
        return new Response(
          JSON.stringify({
            storyId: "story-1",
            revisionId: "revision-1",
            attachedCount: 1,
            duplicatePages: [],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
});

describe("PdfImportPicker", () => {
  it("uploads a PDF and renders the returned thumbnails as a selectable grid", async () => {
    const user = userEvent.setup();
    render(<PdfImportPicker contributors={CONTRIBUTORS} />);

    await uploadAndPreview(user);

    expect(screen.getByRole("button", { name: "Page 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 3" })).toBeInTheDocument();
    expect(screen.getByText("0 of 12 selected")).toBeInTheDocument();
  });

  it("toggles selection via mouse click and shows a running count", async () => {
    const user = userEvent.setup();
    render(<PdfImportPicker contributors={CONTRIBUTORS} />);
    await uploadAndPreview(user);

    const page1 = screen.getByRole("button", { name: "Page 1" });
    await user.click(page1);
    expect(screen.getByText("1 of 12 selected")).toBeInTheDocument();
    expect(page1).toHaveAttribute("aria-pressed", "true");

    await user.click(page1);
    expect(screen.getByText("0 of 12 selected")).toBeInTheDocument();
    expect(page1).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles selection via keyboard (Enter/Space on a focused thumbnail)", async () => {
    const user = userEvent.setup();
    render(<PdfImportPicker contributors={CONTRIBUTORS} />);
    await uploadAndPreview(user);

    const page2 = screen.getByRole("button", { name: "Page 2" });
    page2.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("1 of 12 selected")).toBeInTheDocument();
    expect(page2).toHaveAttribute("aria-pressed", "true");

    await user.keyboard(" ");
    expect(screen.getByText("0 of 12 selected")).toBeInTheDocument();
  });

  it("disables unselected thumbnails once the 12-page limit is reached", async () => {
    const manyPages = {
      pageCount: 13,
      pages: Array.from({ length: 13 }, (_, i) => ({
        pageNumber: i + 1,
        width: 100,
        height: 140,
        dataUrl: "data:image/png;base64,AAA",
      })),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/editorial/new/pdf-preview") {
          return new Response(JSON.stringify(manyPages), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    const user = userEvent.setup();
    render(<PdfImportPicker contributors={CONTRIBUTORS} />);
    await uploadAndPreview(user);

    for (let i = 1; i <= 12; i++) {
      await user.click(screen.getByRole("button", { name: `Page ${i}` }));
    }
    expect(screen.getByText(/12 of 12 selected/)).toBeInTheDocument();

    const page13 = screen.getByRole("button", {
      name: /Page 13, limit of 12 pages reached/,
    });
    expect(page13).toBeDisabled();
  });

  it("keeps the submit button disabled until every selected page has non-empty alt text", async () => {
    const user = userEvent.setup();
    render(<PdfImportPicker contributors={CONTRIBUTORS} />);
    await uploadAndPreview(user);

    const submit = screen.getByRole("button", { name: "Create Import Draft" });
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Page 1" }));
    expect(submit).toBeDisabled();

    const altInput = screen.getByLabelText("Alt text for page 1 (required)");
    await user.type(altInput, "Cover page");
    expect(submit).not.toBeDisabled();

    await user.clear(altInput);
    expect(submit).toBeDisabled();
  });

  it("submits the original file, selected page numbers, and alt text to pdf-attach, then navigates to the editor", async () => {
    const user = userEvent.setup();
    render(<PdfImportPicker contributors={CONTRIBUTORS} />);
    await uploadAndPreview(user);

    await user.click(screen.getByRole("button", { name: "Page 2" }));
    await user.click(screen.getByRole("button", { name: "Page 1" }));
    await user.type(
      screen.getByLabelText("Alt text for page 2 (required)"),
      "Passport stamp page",
    );
    await user.type(
      screen.getByLabelText("Alt text for page 1 (required)"),
      "Cover page",
    );
    await user.type(screen.getByLabelText("Title"), "My Trip");
    // "Existing contributor" is already selected by default (contributors
    // list is non-empty) with Alex Tan as the only <option>.

    await user.click(
      screen.getByRole("button", { name: "Create Import Draft" }),
    );

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/editorial/story-1/edit"),
    );

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const attachCall = fetchMock.mock.calls.find(
      ([url]) => url === "/editorial/new/pdf-attach",
    );
    expect(attachCall).toBeTruthy();
    const body = attachCall![1].body as FormData;
    expect(body.get("title")).toBe("My Trip");
    expect(JSON.parse(body.get("pageNumbers") as string)).toEqual([2, 1]);
    expect(JSON.parse(body.get("altText") as string)).toEqual({
      "2": "Passport stamp page",
      "1": "Cover page",
    });
    expect(body.get("file")).toBeInstanceOf(File);
  });

  it("shows a clear, accessible error when Phase A rejects the upload (e.g. a non-PDF file)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "The file is not a PDF." }), {
            status: 400,
          }),
      ),
    );
    const user = userEvent.setup();
    render(<PdfImportPicker contributors={CONTRIBUTORS} />);

    const input = screen.getByLabelText("PDF file") as HTMLInputElement;
    await user.upload(input, pdfFile());
    await user.click(
      screen.getByRole("button", { name: "Upload & preview pages" }),
    );

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText("The file is not a PDF."),
    ).toBeInTheDocument();
  });
});

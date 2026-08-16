import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { StoryContentBlock } from "@/lib/validation/story";
import { storyContentText } from "@/lib/validation/story";
import { remarkMediaEmbed } from "@/lib/story/remark-media-embed";
import { Spinner } from "@/components/ui/spinner";

/**
 * Renders the story's single Markdown block as real React elements — never
 * `dangerouslySetInnerHTML` (Engineering Rule 7). react-markdown parses the
 * text into an AST (remark/rehype) and renders each node as JSX; raw HTML in
 * the source is never passed through (no rehype-raw plugin), so it can't
 * reach the DOM. Used by both the contributor preview page and the public
 * story-reading page.
 */

/**
 * A `![[mediaId]]` embed token only stores a mediaId (lib/story/markdown-media.ts)
 * — resolving that to an actual URL/alt text is the caller's job, since the
 * answer depends on context: a short-lived signed private-bucket URL for a
 * draft preview, or a plain public-bucket URL for a published story (see the
 * public/preview page callers). A mediaId with NO entry in this map at all
 * (e.g. the image was detached after this content_json was saved) renders
 * nothing, never a broken-image icon or a crash — consistent with this
 * component's "never throw on bad data" posture. A caller that mints the
 * URL asynchronously (PreviewContentBody) can instead set an entry to the
 * literal `"loading"` while the mint is in flight, which renders a spinner
 * in the image's place instead of a jarring blank gap in the text.
 */
export type ContentBlockMediaMap = Record<
  string,
  "loading" | { url: string; altText: string | null; decorative: boolean }
>;

function MediaEmbed({
  mediaId,
  width,
  media,
}: {
  mediaId: string;
  width?: number;
  media: ContentBlockMediaMap;
}) {
  const resolved = media[mediaId];
  if (!resolved) return null;

  const dimensionStyle = width
    ? { width: `${width}px`, maxWidth: "100%" }
    : undefined;
  const frameClassName = width
    ? "my-4 inline-block h-auto rounded-md object-contain"
    : "my-4 block max-h-[32rem] w-full rounded-md object-contain";

  if (resolved === "loading") {
    return (
      <span
        aria-label="Loading image"
        style={{ ...dimensionStyle, aspectRatio: width ? undefined : "16 / 9" }}
        className={`${frameClassName} flex items-center justify-center bg-black/5 text-black/40 dark:bg-white/5 dark:text-white/40`}
      >
        <Spinner className="h-6 w-6" />
      </span>
    );
  }

  // A stored width (set via the editor's drag-to-resize handle) renders at
  // that exact size, capped to the container so it's never wider than the
  // reading column on a narrow screen; no stored width falls back to the
  // original "fill the column" behavior.
  return (
    // eslint-disable-next-line @next/next/no-img-element -- resolved.url is either a short-lived signed URL (draft preview) or a public-bucket URL (published); neither is a stable remote source worth Next/Image's remote-pattern config
    <img
      src={resolved.url}
      alt={resolved.decorative ? "" : (resolved.altText ?? "")}
      style={dimensionStyle}
      className={frameClassName}
    />
  );
}

function buildComponents(media: ContentBlockMediaMap): Components {
  return {
    span({ node, ...props }) {
      const mediaId = node?.properties?.["data-media-id"];
      if (typeof mediaId === "string") {
        const widthAttr = node?.properties?.["data-width"];
        const width =
          typeof widthAttr === "string" ? Number(widthAttr) : undefined;
        return <MediaEmbed mediaId={mediaId} width={width} media={media} />;
      }
      return <span {...props} />;
    },
    h1({ children }) {
      // The Markdown schema itself already rejects `# ` (h1) content
      // (lib/validation/story.ts), but render defensively as an h2 rather
      // than trust that every stored revision passed through that check.
      return (
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {children}
        </h2>
      );
    },
    h2({ children }) {
      return (
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {children}
        </h2>
      );
    },
    h3({ children }) {
      return (
        <h3 className="text-lg font-semibold tracking-tight sm:text-xl">
          {children}
        </h3>
      );
    },
    h4({ children }) {
      return <h4 className="text-lg font-semibold sm:text-lg">{children}</h4>;
    },
    h5({ children }) {
      return <h5 className="text-base font-semibold">{children}</h5>;
    },
    h6({ children }) {
      return <h6 className="text-base font-semibold">{children}</h6>;
    },
    p({ children }) {
      return <p className="text-base leading-relaxed sm:text-lg">{children}</p>;
    },
    blockquote({ children }) {
      return (
        <blockquote className="border-l-2 border-black/20 pl-4 italic dark:border-white/20">
          {children}
        </blockquote>
      );
    },
    ul({ children }) {
      return <ul className="list-disc space-y-1 pl-6">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="list-decimal space-y-1 pl-6">{children}</ol>;
    },
    li({ children, className }) {
      return <li className={className}>{children}</li>;
    },
    a({ href, children }) {
      // href was already validated by isSafeHref() at write time
      // (lib/validation/story.ts) and content_json is immutable once a
      // revision leaves draft, so no re-validation is done here — this
      // component only ever receives already-validated content.
      return (
        <a
          href={href}
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {children}
        </a>
      );
    },
    table({ children }) {
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-base sm:text-lg">
            {children}
          </table>
        </div>
      );
    },
    th({ children }) {
      return (
        <th className="min-w-24 border border-black/10 p-2 text-left align-top font-semibold dark:border-white/10">
          {children}
        </th>
      );
    },
    td({ children }) {
      return (
        <td className="min-w-24 border border-black/10 p-2 align-top dark:border-white/10">
          {children}
        </td>
      );
    },
    code({ children, className }) {
      const isBlock = /language-/.test(className ?? "");
      if (isBlock) {
        return (
          <code className="block overflow-x-auto rounded-md bg-black/5 p-3 font-mono text-sm dark:bg-white/10">
            {children}
          </code>
        );
      }
      return (
        <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-sm dark:bg-white/10">
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <pre className="my-2">{children}</pre>;
    },
  };
}

export function ContentBlockRenderer({
  blocks,
  media = {},
}: {
  blocks: StoryContentBlock[];
  /** See ContentBlockMediaMap's own comment. Optional: content without image embeds needs nothing here. */
  media?: ContentBlockMediaMap;
}) {
  const text = storyContentText(blocks);
  return (
    <div className="space-y-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMediaEmbed]}
        components={buildComponents(media)}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

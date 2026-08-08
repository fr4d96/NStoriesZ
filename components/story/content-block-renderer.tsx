import type {
  StoryContentBlock,
  StoryMark,
  StoryTextRun,
} from "@/lib/validation/story";

/**
 * Renders the canonical block/run/mark content schema as real React
 * elements — never `dangerouslySetInnerHTML` (Engineering Rule 7). Every
 * piece of text passes through JSX as a plain string, so React's own
 * escaping is the only thing standing between story content and the DOM;
 * there is no HTML-parsing step anywhere in this component. Used by both
 * the contributor preview page and the public story-reading page.
 */

/**
 * An "image" block only stores a mediaId (lib/validation/story.ts's
 * imageBlockSchema) — resolving that to an actual URL/alt text is the
 * caller's job, since the answer depends on context: a short-lived signed
 * private-bucket URL for a draft preview, or a plain public-bucket URL for
 * a published story (see the public/preview page callers). A mediaId with
 * no entry in this map (e.g. the image was detached after this content_json
 * was saved) renders nothing, never a broken-image icon or a crash —
 * consistent with this component's "never throw on bad data" posture.
 */
export type ContentBlockMediaMap = Record<
  string,
  { url: string; altText: string | null; decorative: boolean }
>;

function Run({ run, keyPrefix }: { run: StoryTextRun; keyPrefix: string }) {
  let node: React.ReactNode = run.text;
  const marks = run.marks ?? [];

  // Applied innermost-first so nesting order is deterministic regardless of
  // how marks were ordered in content_json.
  for (const mark of marks) {
    node = applyMark(mark, node, keyPrefix);
  }
  return <>{node}</>;
}

function applyMark(
  mark: StoryMark,
  node: React.ReactNode,
  keyPrefix: string,
): React.ReactNode {
  if (mark === "bold") return <strong key={`${keyPrefix}-b`}>{node}</strong>;
  if (mark === "italic") return <em key={`${keyPrefix}-i`}>{node}</em>;
  // Link mark: href was already validated by isSafeHref() at write time
  // (lib/validation/story.ts) and content_json is immutable once a
  // revision leaves draft, so no re-validation is done here — this
  // component only ever receives already-validated content.
  return (
    <a
      key={`${keyPrefix}-l`}
      href={mark.href}
      rel="noopener noreferrer"
      className="underline underline-offset-2"
    >
      {node}
    </a>
  );
}

function RunList({
  runs,
  blockKey,
}: {
  runs: StoryTextRun[];
  blockKey: string;
}) {
  return (
    <>
      {runs.map((run, i) => (
        <Run
          key={`${blockKey}-${i}`}
          run={run}
          keyPrefix={`${blockKey}-${i}`}
        />
      ))}
    </>
  );
}

function Block({
  block,
  index,
  media,
}: {
  block: StoryContentBlock;
  index: number;
  media: ContentBlockMediaMap;
}) {
  const key = `block-${index}`;
  switch (block.type) {
    case "paragraph":
      return (
        <p className="text-base leading-relaxed sm:text-lg">
          <RunList runs={block.text} blockKey={key} />
        </p>
      );
    case "heading": {
      const Tag = block.level === 2 ? "h2" : "h3";
      return (
        <Tag
          className={
            block.level === 2
              ? "text-xl font-semibold tracking-tight sm:text-2xl"
              : "text-lg font-semibold tracking-tight sm:text-xl"
          }
        >
          <RunList runs={block.text} blockKey={key} />
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote className="border-l-2 border-black/20 pl-4 italic dark:border-white/20">
          <RunList runs={block.text} blockKey={key} />
        </blockquote>
      );
    case "list": {
      const ListTag = block.style === "ordered" ? "ol" : "ul";
      return (
        <ListTag
          className={
            block.style === "ordered"
              ? "list-decimal space-y-1 pl-6"
              : "list-disc space-y-1 pl-6"
          }
        >
          {block.items.map((item, i) => (
            <li key={`${key}-item-${i}`}>
              <RunList runs={item} blockKey={`${key}-item-${i}`} />
            </li>
          ))}
        </ListTag>
      );
    }
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-base sm:text-lg">
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${key}-row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${key}-row-${rowIndex}-cell-${cellIndex}`}
                      className="min-w-24 border border-black/10 p-2 align-top dark:border-white/10"
                    >
                      <RunList
                        runs={cell}
                        blockKey={`${key}-row-${rowIndex}-cell-${cellIndex}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "image": {
      const resolved = media[block.mediaId];
      if (!resolved) return null;
      return (
        // eslint-disable-next-line @next/next/no-img-element -- resolved.url is either a short-lived signed URL (draft preview) or a public-bucket URL (published); neither is a stable remote source worth Next/Image's remote-pattern config
        <img
          src={resolved.url}
          alt={resolved.decorative ? "" : (resolved.altText ?? "")}
          className="max-h-[32rem] w-full rounded-md object-contain"
        />
      );
    }
  }
}

export function ContentBlockRenderer({
  blocks,
  media = {},
}: {
  blocks: StoryContentBlock[];
  /** See ContentBlockMediaMap's own comment. Optional: content without image blocks needs nothing here. */
  media?: ContentBlockMediaMap;
}) {
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => (
        <Block key={i} block={block} index={i} media={media} />
      ))}
    </div>
  );
}

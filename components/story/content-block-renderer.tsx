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
 * there is no HTML-parsing step anywhere in this component. Used by the
 * contributor preview page today; the public story-reading page (a later
 * prompt) can reuse this unchanged since it renders the same schema.
 */

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

function Block({ block, index }: { block: StoryContentBlock; index: number }) {
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
  }
}

export function ContentBlockRenderer({
  blocks,
}: {
  blocks: StoryContentBlock[];
}) {
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => (
        <Block key={i} block={block} index={i} />
      ))}
    </div>
  );
}

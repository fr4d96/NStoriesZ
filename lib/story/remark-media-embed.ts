import { visit } from "unist-util-visit";
import type { Root, Text, Parent } from "mdast";
import { MEDIA_EMBED_REGEX } from "@/lib/story/markdown-media";

// mdast has no built-in "image reference" node type — `![[mediaId]]` (or
// `![[mediaId|width]]` once resized) is a deliberately non-standard token
// (see markdown-media.ts), so plain text nodes containing it are split into
// text/mediaEmbed siblings here. The mediaEmbed node's `data.hName`/
// `hProperties` tell mdast-util-to-hast to emit a
// `<span data-media-embed data-media-id data-width>` element, which
// content-block-renderer.tsx then maps via react-markdown's `components`
// prop -- never raw HTML, just data attributes on a plain hast element.
// hName "span" (not "div"): the token can sit inside a paragraph's inline
// children, and `<span>` is valid phrasing content there (unlike `<div>`,
// which would produce invalid `<div>`-inside-`<p>` HTML nesting and a React
// hydration warning). An `<img>` inside that span is itself valid phrasing
// content.
export interface MediaEmbedNode {
  type: "mediaEmbed";
  mediaId: string;
  width?: number;
  data: {
    hName: "span";
    hProperties: {
      "data-media-embed": "true";
      "data-media-id": string;
      "data-width"?: string;
    };
  };
}

export function remarkMediaEmbed() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;
      const regex = new RegExp(MEDIA_EMBED_REGEX);
      if (!regex.test(node.value)) return;
      regex.lastIndex = 0;

      const nodes: (Text | MediaEmbedNode)[] = [];
      let lastEnd = 0;
      for (const match of node.value.matchAll(regex)) {
        const start = match.index ?? 0;
        if (start > lastEnd) {
          nodes.push({ type: "text", value: node.value.slice(lastEnd, start) });
        }
        const mediaId = match[1].toLowerCase();
        const width = match[2] ? Number(match[2]) : undefined;
        nodes.push({
          type: "mediaEmbed",
          mediaId,
          width,
          data: {
            hName: "span",
            hProperties: {
              "data-media-embed": "true",
              "data-media-id": mediaId,
              ...(width ? { "data-width": String(width) } : {}),
            },
          },
        });
        lastEnd = start + match[0].length;
      }
      if (lastEnd < node.value.length) {
        nodes.push({ type: "text", value: node.value.slice(lastEnd) });
      }

      parent.children.splice(index, 1, ...(nodes as never[]));
      return index + nodes.length;
    });
  };
}

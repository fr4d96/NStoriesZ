import { getPublicImageUrl } from "@/lib/story/public-image-url";

type GalleryImage = {
  media_id: string;
  // Despite the RPC's column name, get_published_story_media() actually
  // returns the raw storage path (approved_public_storage_path), not a
  // full URL -- run through getPublicImageUrl() below, same as every other
  // public image on this site.
  public_url: string | null;
  alt_text: string | null;
  caption: string | null;
  decorative: boolean;
  sort_order: number;
  is_cover: boolean;
};

/**
 * The public gallery, placed distinctly from the body text (design-brief
 * "Story detail layout") -- content_json has no inline image blocks by
 * design (docs/architecture.md), so this always renders after the text.
 */
export function StoryGallery({ images }: { images: GalleryImage[] }) {
  if (images.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {images.map((image) => {
        const url = getPublicImageUrl(image.public_url);
        if (!url) return null;
        return (
          <figure
            key={image.media_id}
            className="overflow-hidden rounded-lg border border-border-subtle bg-surface-muted"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- public bucket URLs are content-addressed, not a Next.js image-optimizable source list */}
            <img
              src={url}
              alt={image.decorative ? "" : (image.alt_text ?? "")}
              loading="lazy"
              className="h-full w-full object-cover"
            />
            {image.caption ? (
              <figcaption className="p-2 text-xs text-foreground/60">
                {image.caption}
              </figcaption>
            ) : null}
          </figure>
        );
      })}
    </div>
  );
}

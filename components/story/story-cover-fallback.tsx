import Image from "next/image";

/**
 * The one placeholder every "this story has no cover photo" slot renders --
 * story cards, the home page's featured stack, and the contributor's own
 * My Stories thumbnails. Replaces the three separate grey boxes reading
 * "No photo", which told the reader nothing they could not already see and
 * left a dead rectangle in an otherwise photo-led grid.
 *
 * `public/NoImage.png` is a hand-drawn camera sketch on paper stock -- it
 * reads as part of the Field Journal world rather than as a broken image,
 * and it is the same drawing in every slot, so an empty card looks
 * deliberate instead of missing. Served through next/image (not a bare
 * <img>) specifically because the source file is a 2MB 1407x768 PNG: the
 * optimizer resizes it per `sizes` and re-encodes it, so a 200px-wide card
 * does not download the full-resolution original.
 *
 * `alt=""` on purpose. This carries no information a screen-reader user
 * needs -- the story's title and attribution, right next to it, are the
 * content -- so it stays decorative rather than announcing "no image"
 * before every untitled card.
 *
 * Uses `fill`, so every call site's wrapper must be positioned
 * (`relative`); the wrapper also owns the aspect ratio and the overflow
 * clip, exactly as it does for a real cover photo.
 */
export function StoryCoverFallback({
  sizes = "(min-width: 640px) 33vw, 100vw",
  className = "",
}: {
  sizes?: string;
  className?: string;
}) {
  return (
    <Image
      src="/NoImage.png"
      alt=""
      fill
      sizes={sizes}
      className={`object-cover ${className}`}
    />
  );
}

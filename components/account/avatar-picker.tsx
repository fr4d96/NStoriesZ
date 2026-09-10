"use client";

import { useState } from "react";
import { AVATAR_EMOJI_OPTIONS, type AvatarEmoji } from "@/lib/avatar";

/**
 * The emoji avatar chooser, lifted out of ProfileForm when the public
 * identity moved onto `contributors` and the picker moved with it. Kept as
 * one component rather than copied so the fixed emoji set, the toggle-to-
 * clear behaviour and the aria-pressed semantics can only be got right (or
 * wrong) in one place.
 *
 * Renders a hidden input so the value posts with the surrounding form the
 * same way it always did -- the buttons are type="button" precisely so
 * picking an avatar never submits.
 */
export function AvatarPicker({
  name,
  initial,
  label = "Avatar",
  hint,
}: {
  name: string;
  initial: string;
  label?: string;
  hint?: string;
}) {
  const [selected, setSelected] = useState<AvatarEmoji | "">(
    AVATAR_EMOJI_OPTIONS.includes(initial as AvatarEmoji)
      ? (initial as AvatarEmoji)
      : "",
  );

  return (
    <div>
      <input type="hidden" name={name} value={selected} />
      <span className="block text-sm font-medium">{label}</span>
      <div className="mt-2 grid grid-cols-8 gap-2 sm:grid-cols-12">
        {AVATAR_EMOJI_OPTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() =>
              setSelected((current) => (current === emoji ? "" : emoji))
            }
            aria-pressed={selected === emoji}
            aria-label={`Use ${emoji} as your avatar`}
            className={`flex aspect-square items-center justify-center rounded-full border text-lg transition-colors ${
              selected === emoji
                ? "border-accent bg-accent/15"
                : "border-border-subtle hover:bg-surface-muted"
            }`}
          >
            {emoji}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-foreground/55">
        {selected
          ? "Tap your chosen avatar again to remove it."
          : (hint ?? "Pick an avatar, or leave unset for the default.")}
      </p>
    </div>
  );
}

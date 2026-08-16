"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  updateProfileAction,
  type AccountFormState,
} from "@/app/(contributor)/actions";
import { AVATAR_EMOJI_OPTIONS, type AvatarEmoji } from "@/lib/avatar";

const initialState: AccountFormState = {};

export function ProfileForm({
  displayName,
  bio,
  homeCountryCode,
  publicProfileEnabled,
  publicSlug,
  avatarEmoji,
}: {
  displayName: string;
  bio: string;
  homeCountryCode: string;
  publicProfileEnabled: boolean;
  publicSlug: string;
  avatarEmoji: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateProfileAction,
    initialState,
  );
  const [selectedEmoji, setSelectedEmoji] = useState<AvatarEmoji | "">(
    AVATAR_EMOJI_OPTIONS.includes(avatarEmoji as AvatarEmoji)
      ? (avatarEmoji as AvatarEmoji)
      : "",
  );

  return (
    <form action={formAction} className="mt-4 space-y-5" noValidate>
      <input type="hidden" name="avatarEmoji" value={selectedEmoji} />

      <div>
        <span className="block text-sm font-medium">Avatar</span>
        <div className="mt-2 grid grid-cols-8 gap-2 sm:grid-cols-12">
          {AVATAR_EMOJI_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() =>
                setSelectedEmoji((current) => (current === emoji ? "" : emoji))
              }
              aria-pressed={selectedEmoji === emoji}
              aria-label={`Use ${emoji} as your avatar`}
              className={`flex aspect-square items-center justify-center rounded-full border text-lg transition-colors ${
                selectedEmoji === emoji
                  ? "border-accent bg-accent/15"
                  : "border-border-subtle hover:bg-surface-muted"
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-foreground/55">
          {selectedEmoji
            ? "Tap your chosen avatar again to remove it."
            : "Pick an avatar, or leave unset for the default."}
        </p>
      </div>

      <div>
        <label htmlFor="displayName" className="block text-sm font-medium">
          Display name
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          maxLength={120}
          required
          defaultValue={displayName}
          className="mt-1 w-full rounded-xl border border-border-subtle bg-surface px-3 py-2 focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="homeCountryCode" className="block text-sm font-medium">
          Home country code
        </label>
        <input
          id="homeCountryCode"
          name="homeCountryCode"
          type="text"
          maxLength={2}
          required
          defaultValue={homeCountryCode}
          className="mt-1 w-24 rounded-xl border border-border-subtle bg-surface px-3 py-2 uppercase focus:border-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-foreground/55">
          2-letter code, e.g. MY.
        </p>
      </div>

      <div>
        <label htmlFor="bio" className="block text-sm font-medium">
          Bio
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={4}
          maxLength={2000}
          defaultValue={bio}
          className="mt-1 w-full rounded-xl border border-border-subtle bg-surface px-3 py-2 focus:border-accent focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="publicProfileEnabled"
          name="publicProfileEnabled"
          type="checkbox"
          defaultChecked={publicProfileEnabled}
          className="h-4 w-4 accent-accent"
        />
        <label htmlFor="publicProfileEnabled" className="text-sm font-medium">
          Make my profile public
        </label>
      </div>

      <div>
        <label htmlFor="publicSlug" className="block text-sm font-medium">
          Public profile URL
        </label>
        <input
          id="publicSlug"
          name="publicSlug"
          type="text"
          maxLength={60}
          defaultValue={publicSlug}
          className="mt-1 w-full rounded-xl border border-border-subtle bg-surface px-3 py-2 focus:border-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-foreground/55">
          Required to make your profile public. Nothing else is shown publicly
          unless you enable the toggle above.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-fern">
          {state.success}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="journiq-button bg-accent text-sm text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}

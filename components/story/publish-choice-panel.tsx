"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { SubmitConsentPanel } from "@/components/story/submit-consent-panel";
import { EyeIcon, HiddenEyeIcon } from "@/components/icons";
import type { StoryRequirement } from "@/lib/story/steps";
import type { StoryDestination } from "@/lib/story/story-visibility";
import {
  keepStoryPrivateAction,
  type ConsentActionState,
} from "@/app/(contributor)/stories/[id]/preview/actions";

const initialState: ConsentActionState = {};

export type PublishChoicePanelProps = {
  storyId: string;
  revisionId: string;
  expectedVersion: number;
  hasMedia: boolean;
  isEditorialImport: boolean;
  submitLabel: string;
  /**
   * Whether "Keep it private" is offered at all. Mirrors
   * keep_revision_private()'s own two refusals -- an editorial import, and
   * a story that has already been published -- so the contributor is not
   * shown a choice the database would reject. The RPC stays the real check.
   */
  allowPrivate: boolean;
  /** The story is already private; the choice is preselected accordingly. */
  isAlreadyPrivate: boolean;
  /**
   * The two answers to "what is this story still missing", both computed
   * SERVER-side on the preview page and passed down, rather than one answer
   * computed here from client state.
   *
   * They differ: a public story also needs a location and a tag so it can be
   * found in browse and search; a private one needs neither, because nobody
   * will ever search for it. Since the destination is now a choice the
   * contributor makes in the browser, the page cannot know which gate to
   * compute -- so it computes both and this switches between two fixed
   * results. What it must NOT do is re-derive either list here: that would
   * put a gate in client code where a fresh server read belongs
   * (Engineering Rule 2), and the two copies would drift.
   */
  missingForPublic: StoryRequirement[];
  missingForPrivate: StoryRequirement[];
  /** Whether to offer "Go to that step" links out of the missing-requirements notice. */
  canEdit: boolean;
};

/**
 * The last step of writing a story: where is it going?
 *
 *   Publish publicly -> a moderator reviews it, then it goes live.
 *   Keep it private  -> nobody reviews it, because nobody else will see it.
 *
 * That asymmetry is the whole feature. Moderation exists to protect what
 * the public sees, so a story with no public side has nothing to review.
 * The two branches are genuinely different actions against different RPCs
 * (submit_revision_with_consent vs keep_revision_private), not one action
 * with a flag -- which is why they render as two separate <form>s rather
 * than one form with a hidden field. A single form would need one Server
 * Action that branches internally on a client-supplied value, and that
 * value would then be deciding whether consent gets recorded. Two forms
 * means the private path has no way to reach the consent code at all.
 *
 * The radio group sits OUTSIDE both forms deliberately: it is a view
 * switch, not a submitted field, and nothing about the contributor's choice
 * is trusted server-side -- each action is bound to exactly one RPC.
 */
export function PublishChoicePanel({
  storyId,
  revisionId,
  expectedVersion,
  hasMedia,
  isEditorialImport,
  submitLabel,
  allowPrivate,
  isAlreadyPrivate,
  missingForPublic,
  missingForPrivate,
  canEdit,
}: PublishChoicePanelProps) {
  // Public is preselected because this is a public stories platform and it
  // is what the button did before this panel existed -- a contributor who
  // has always published is not made to re-answer a question they have
  // already answered by habit. The consequential half still cannot happen
  // by momentum: publishing additionally requires ticking the permission
  // checkbox below. A story that is ALREADY private opens on its own
  // current state instead, so re-saving it is the default and going public
  // is the deliberate act.
  const [destination, setDestination] = useState<StoryDestination>(
    isAlreadyPrivate && allowPrivate ? "private" : "public",
  );

  // Not offered => never rendered, and the public branch is all there is.
  const choice: StoryDestination = allowPrivate ? destination : "public";
  const missing = choice === "public" ? missingForPublic : missingForPrivate;

  return (
    <div className="flex flex-col gap-4">
      {allowPrivate && (
        <fieldset className="rounded-md border border-border-subtle p-4">
          <legend className="px-1 text-sm font-semibold">
            Who is this story for?
          </legend>
          <div className="mt-1 flex flex-col gap-2">
            <DestinationOption
              value="public"
              checked={choice === "public"}
              onSelect={setDestination}
              icon={<EyeIcon className="h-5 w-5" aria-hidden />}
              title="Everyone"
              description="A moderator reads it first. Once they approve it, anyone can find and read it."
            />
            <DestinationOption
              value="private"
              checked={choice === "private"}
              onSelect={setDestination}
              icon={<HiddenEyeIcon className="h-5 w-5" aria-hidden />}
              title="Just me"
              description="Nobody reviews it and nobody else can see it. You can still edit it, or share it publicly later."
            />
          </div>
        </fieldset>
      )}

      {missing.length > 0 ? (
        <MissingRequirementsNotice
          storyId={storyId}
          missing={missing}
          canEdit={canEdit}
        />
      ) : choice === "public" ? (
        <SubmitConsentPanel
          storyId={storyId}
          revisionId={revisionId}
          expectedVersion={expectedVersion}
          hasMedia={hasMedia}
          isEditorialImport={isEditorialImport}
          submitLabel={submitLabel}
        />
      ) : (
        <KeepPrivateForm
          storyId={storyId}
          revisionId={revisionId}
          expectedVersion={expectedVersion}
          isAlreadyPrivate={isAlreadyPrivate}
        />
      )}
    </div>
  );
}

/**
 * One radio, styled as a full-width tappable card. The whole card is the
 * <label>, so the hit target is the card rather than the 16px dot -- the
 * mobile-first rule (Engineering Rule 18), checked at 375px where these
 * stack.
 *
 * The native radio stays in the DOM and keeps its own focus ring rather
 * than being replaced by a styled <div>: that is what keeps arrow-key
 * navigation between the two options, the grouping announcement from the
 * <fieldset>/<legend>, and the checked state all working for a screen
 * reader without re-implementing any of it (Engineering Rule 19).
 */
function DestinationOption({
  value,
  checked,
  onSelect,
  icon,
  title,
  description,
}: {
  value: StoryDestination;
  checked: boolean;
  onSelect: (value: StoryDestination) => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
        checked
          ? "border-accent bg-accent/5"
          : "border-border-subtle hover:bg-surface-muted"
      }`}
    >
      <input
        type="radio"
        name="storyDestination"
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="mt-1"
      />
      <span className="flex-1">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  );
}

/**
 * "Add a title, at least one tag before you can submit."
 *
 * Moved here from the preview page so it can change with the destination --
 * choosing "Just me" drops the location/tag requirements, and the notice
 * has to stop asking for them in the same click. The list itself is still
 * server-computed and handed in; this only picks which of the two to show.
 */
function MissingRequirementsNotice({
  storyId,
  missing,
  canEdit,
}: {
  storyId: string;
  missing: StoryRequirement[];
  canEdit: boolean;
}) {
  return (
    <div
      role="status"
      className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >
      <p className="font-medium">
        Add {missing.map((r) => r.label).join(", ")} before you can save this
        story.
      </p>
      {canEdit && (
        <Link
          href={`/stories/${storyId}/edit?step=${missing[0]?.step ?? "title"}`}
          className="mt-1 inline-block underline underline-offset-2"
        >
          Go to that step
        </Link>
      )}
    </div>
  );
}

/**
 * The private branch. Compare it with SubmitConsentPanel: no permission
 * checkbox, no image-rights checkbox, no identifiable-people question.
 *
 * That is not a shortcut, it is the correct form. Every one of those fields
 * records permission to put this story -- and someone else's face -- in
 * front of the public (docs/content-governance.md). Nothing here goes in
 * front of anyone, so asking would either collect a permission that was
 * never needed, or worse, file one on a story the contributor explicitly
 * chose not to publish.
 */
function KeepPrivateForm({
  storyId,
  revisionId,
  expectedVersion,
  isAlreadyPrivate,
}: {
  storyId: string;
  revisionId: string;
  expectedVersion: number;
  isAlreadyPrivate: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    keepStoryPrivateAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      className="rounded-md border border-border-subtle p-4"
    >
      <input type="hidden" name="storyId" value={storyId} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />

      <h2 className="text-sm font-semibold">Keeping this one to yourself</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        No moderator reads it, and it never shows up in search, on the public
        site, or on your public profile. Your photos stay private too.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        You can keep editing it whenever you like. If you change your mind
        later, come back here and choose &ldquo;Everyone&rdquo; — that is when
        it goes to a moderator.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-60"
      >
        {pending
          ? "Saving…"
          : isAlreadyPrivate
            ? "Save changes"
            : "Save as private"}
      </button>

      {state.error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.success && (
        <p
          role="status"
          className="mt-2 text-sm text-green-700 dark:text-green-400"
        >
          {state.success}
        </p>
      )}
    </form>
  );
}

"use client";

import * as React from "react";

import { ImageIcon, Loader2 } from "lucide-react";
import { useEditorRef } from "platejs/react";

import {
  MAX_IMAGES_PER_REVISION,
  MAX_UPLOAD_BYTES,
} from "@/lib/story/image-validation";
import { getErrorMessage } from "@/lib/errors";

import { ToolbarButton } from "./toolbar";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type ImageUploadContext = {
  storyId: string;
  revisionId: string;
  versionRef: React.MutableRefObject<number>;
  onVersionBumped: () => void;
};

/**
 * Uploads through the exact same route, storage bucket, and
 * story_revision_media row that components/story/image-upload-manager.tsx's
 * gallery uses (`/stories/[id]/edit/upload`) -- there is no second upload
 * path. The only new thing this button does is insert `{ type: "image",
 * mediaId }` at the cursor afterward; alt text/caption/decorative/cover
 * stay edited in the gallery panel, per this feature's design (see
 * lib/validation/story.ts's imageBlockSchema comment).
 */
export function ImageToolbarButton({
  storyId,
  revisionId,
  versionRef,
  onVersionBumped,
}: ImageUploadContext) {
  const editor = useEditorRef();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleFile(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Use JPEG, PNG, or WebP.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("File is too large (max 15 MB).");
      return;
    }

    setError(null);
    setUploading(true);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("revisionId", revisionId);
    formData.set("expectedVersion", String(versionRef.current));

    try {
      const response = await fetch(`/stories/${storyId}/edit/upload`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as {
        mediaId?: string;
        error?: string;
      };
      if (!response.ok || !body.mediaId) {
        throw new Error(
          body.error ??
            `Upload failed (max ${MAX_IMAGES_PER_REVISION} images per story).`,
        );
      }
      // finalize_story_media_upload bumped the authoring version by
      // exactly one on success (same guarantee image-upload-manager.tsx
      // relies on).
      versionRef.current += 1;
      onVersionBumped();
      editor.tf.insertNodes({
        type: "image",
        mediaId: body.mediaId,
        children: [{ text: "" }],
      } as never);
    } catch (err) {
      setError(getErrorMessage(err, "Upload failed."));
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <ToolbarButton
        tooltip={error ?? "Insert image"}
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading ? <Loader2 className="animate-spin" /> : <ImageIcon />}
      </ToolbarButton>
    </>
  );
}

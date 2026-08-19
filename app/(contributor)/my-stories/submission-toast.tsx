"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/toast";

const TOAST_MESSAGES: Record<string, string> = {
  submitted: "Submitted for review.",
};

/**
 * submitOwnConsentAction (app/(contributor)/stories/[id]/preview/actions.ts)
 * redirects here on success rather than returning a state the submitting
 * page could render inline -- redirect() throws before React ever sees a
 * "success" state. This picks up the `toast` query param that redirect
 * appends and fires the confirmation here instead, then strips the param so
 * a refresh or back-navigation doesn't re-fire it.
 */
export function SubmissionToast() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toastKey = searchParams.get("toast");
  const { showToast } = useToast();

  useEffect(() => {
    if (!toastKey) return;
    const message = TOAST_MESSAGES[toastKey];
    if (message) showToast(message);
    const params = new URLSearchParams(searchParams);
    params.delete("toast");
    const query = params.toString();
    router.replace(query ? `/my-stories?${query}` : "/my-stories", {
      scroll: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per toastKey value, not on every searchParams/router identity change
  }, [toastKey]);

  return null;
}

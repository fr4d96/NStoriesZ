"use client";

import { useActionState } from "react";
import type { RoleOption } from "@/lib/admin/role-changes";
import { setUserRoleAction, type SetUserRoleActionState } from "../actions";

const initialState: SetUserRoleActionState = {};

/**
 * One submit button per role, rather than a select + save. A role change is
 * a discrete, consequential act -- an explicit "Make editor" button says
 * what will happen, and an unavailable role can carry its own reason inline
 * instead of silently failing on submit.
 *
 * The disabled state is a MIRROR of admin_set_user_role()'s own guards (see
 * lib/admin/role-changes.ts) -- it is a courtesy, not the enforcement.
 * A hand-crafted submit for a disabled role reaches the Server Action, the
 * Zod schema, and then the database's own checks, and is rejected there.
 */
export function RoleForm({
  userId,
  options,
}: {
  userId: string;
  options: RoleOption[];
}) {
  const [state, formAction, pending] = useActionState(
    setUserRoleAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="userId" value={userId} />
      <fieldset disabled={pending} className="flex flex-col gap-2">
        <legend className="sr-only">Change this account&rsquo;s role</legend>
        {options.map((option) => (
          <div key={option.role} className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              name="role"
              value={option.role}
              disabled={!option.availability.allowed}
              className="rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {pending ? "Saving…" : `Make ${option.label.toLowerCase()}`}
            </button>
            {!option.availability.allowed && (
              <span className="text-xs text-muted-foreground">
                {option.availability.reason}
              </span>
            )}
          </div>
        ))}
      </fieldset>
      {state.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {state.success}
        </p>
      )}
    </form>
  );
}

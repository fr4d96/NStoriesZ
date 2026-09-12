/**
 * Fired on `window` after the /notifications page successfully marks
 * something read, so the header bell re-counts instead of showing a stale
 * badge beside a page that already updated.
 *
 * The two components are siblings with no shared parent state -- the bell
 * lives in the header (rendered by a layout), the list in the page -- and
 * the mark-read goes through a Server Action, so revalidatePath() re-renders
 * the page but cannot touch the bell's client state. A window event is the
 * smallest thing that crosses that gap without hoisting a context provider
 * around the whole app for one number.
 *
 * Deliberately a plain string constant in its own module: both sides import
 * it, so the name can never drift between them.
 */
export const NOTIFICATIONS_CHANGED_EVENT = "kakinotes:notifications-changed";

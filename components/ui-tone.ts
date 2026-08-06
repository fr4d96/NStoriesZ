// Shared "sits on a dark/photo background vs. a normal surface" class pair
// for small bordered controls (theme toggle, mobile nav toggle).
export const INVERTED_CONTROL_CLASSES =
  "border-white/40 bg-black/25 text-white hover:bg-black/35";
export const DEFAULT_CONTROL_CLASSES =
  "border-border-subtle text-foreground hover:bg-surface-muted";

export function controlToneClasses(inverted: boolean): string {
  return inverted ? INVERTED_CONTROL_CLASSES : DEFAULT_CONTROL_CLASSES;
}

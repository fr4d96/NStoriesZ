/** Small uppercase section kicker, matching journiq_landing_page_card_stack.html's .eyebrow. */
export function Eyebrow({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "onDark" | "onPhoto";
}) {
  const color = tone === "default" ? "text-fern" : "text-white";
  return (
    <span
      className={`inline-flex items-center gap-2 text-xs font-bold tracking-[0.13em] uppercase ${color}`}
    >
      <span aria-hidden="true" className="h-px w-6 bg-current" />
      {children}
    </span>
  );
}

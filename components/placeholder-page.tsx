export function PlaceholderPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h1>
      <div className="mt-4 space-y-4 text-black/70 dark:text-white/70">
        {children}
      </div>
    </div>
  );
}

import Image from "next/image";

export function BrandLogo({
  className = "",
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/kakinotes-icon.png"
      alt=""
      width={36}
      height={36}
      priority={priority}
      className={`h-9 w-9 rounded-full object-cover ${className}`}
    />
  );
}

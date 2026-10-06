import { cn } from "@/lib/utils";

// The AgentOS mark: an "A" that is also a prompt, with the cursor at rest
// inside it. Same drawing as public/icon.svg.
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      aria-hidden
      className={cn("h-7 w-7 shrink-0", className)}
    >
      <rect width="512" height="512" rx="116" fill="#7C3AED" />
      <path
        d="M256 104 L400 400 L324 400 L256 254 L188 400 L112 400 Z"
        fill="#FFFFFF"
      />
      <rect x="226" y="344" width="60" height="56" fill="#0E0E14" />
    </svg>
  );
}

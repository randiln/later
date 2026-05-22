import { cn } from "../lib/utils";

type Tone = "accent" | "live" | "muted";

const toneClasses: Record<Tone, string> = {
  accent: "bg-accent/10 border-accent/20 text-accent",
  live: "bg-green-500/10 border-green-500/20 text-green-500",
  muted: "bg-white/5 border-white/10 text-text-muted",
};

export default function Badge({
  label,
  tone = "accent",
  className,
}: {
  label: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block px-4 py-1.5 rounded-full border text-[10px] uppercase tracking-[0.2em] font-bold",
        toneClasses[tone],
        className
      )}
    >
      {label}
    </span>
  );
}

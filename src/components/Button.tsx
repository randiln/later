import { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/utils";

type Variant = "primary" | "accent";

const variantClasses: Record<Variant, string> = {
  primary: "bg-white text-black shadow-xl shadow-accent/5",
  accent: "bg-accent text-zinc-950 shadow-xl shadow-accent/10",
};

export default function Button({
  variant = "primary",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={cn(
        "w-full py-5 rounded-[2.5rem] font-bold flex items-center justify-center space-x-2",
        "active:scale-[0.98] transition-transform disabled:opacity-50",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

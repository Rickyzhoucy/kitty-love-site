import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Even though we aren't using Tailwind extensively, this is a good utility to have
// for conditional classes if we were using it, but for vanilla CSS modules + conditional classes
// a simple joiner is fine. However, since the user said "no tailwind", I will just use a simple helper.
// Actually, let's just make a simple one.

export function cn(...inputs: (string | undefined | null | false)[]) {
    return inputs.filter(Boolean).join(" ");
}

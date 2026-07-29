import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 Tailwind 类名：clsx 处理条件，twMerge 解决冲突 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

import type { InputHTMLAttributes } from "react";

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input
        {...props}
        className="rounded border border-zinc-400 bg-transparent px-3 py-2 text-base font-normal"
      />
    </label>
  );
}

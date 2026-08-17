"use client";

import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/utils";

export function EditableText({
  value,
  onValueChange,
  className,
  optional = false,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;

  optional?: boolean;
}): React.ReactElement {
  const [draft, setDraft] = useState(value);
  const revert = useRef(false);
  useEffect(() => setDraft(value), [value]);

  function commit() {
    if (revert.current) {
      revert.current = false;
      setDraft(value);
      return;
    }
    const next = draft.trim();
    if (!next && !optional) return setDraft(value);
    if (next !== value) onValueChange(next);
  }

  return (
    <input
      className={cn(
        "w-full cursor-pointer rounded-sm border border-transparent bg-transparent p-1 font-[inherit] text-[length:inherit] leading-[inherit] outline-none transition-colors duration-150 focus:cursor-text hover:border-pa-line focus-within:border-pa-line disabled:cursor-default disabled:hover:border-transparent",
        className,
      )}
      data-slot="editable-text"
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.stopPropagation();
          revert.current = true;
          event.currentTarget.blur();
        }
      }}
      type="text"
      value={draft}
      {...props}
    />
  );
}

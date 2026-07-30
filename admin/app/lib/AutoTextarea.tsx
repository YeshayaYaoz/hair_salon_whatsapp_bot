"use client";

import { useEffect, useRef } from "react";

/**
 * A textarea that grows to fit its content instead of scrolling inside a fixed box.
 *
 * These fields hold text the bot reads out to customers — service descriptions, FAQ answers — so
 * the owner needs to see the whole thing while writing it. A fixed-height box hides everything past
 * the first couple of lines, which is exactly when a long answer most needs proofreading.
 *
 * Height is driven off scrollHeight rather than counting newlines, so wrapped long lines are
 * measured the same as explicit line breaks.
 */
export function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
  minRows = 2,
  maxRows = 12,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
  maxRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset first: scrollHeight only shrinks back if the element isn't already holding the taller
    // height from the previous value, so without this the box can grow but never shrink.
    el.style.height = "auto";
    const styles = window.getComputedStyle(el);
    const lineHeight = parseFloat(styles.lineHeight) || 20;
    const padding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const border = parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);
    const min = lineHeight * minRows + padding + border;
    const max = lineHeight * maxRows + padding + border;
    const next = Math.min(Math.max(el.scrollHeight + border, min), max);
    el.style.height = `${next}px`;
    // Past maxRows the box stops growing, so it has to scroll rather than clip the overflow.
    el.style.overflowY = el.scrollHeight + border > max ? "auto" : "hidden";
  }, [value, minRows, maxRows]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      style={{ resize: "none" }}
    />
  );
}

"use client";

/**
 * "Saved" confirmation, used across the settings-style pages.
 *
 * `role="status"` (an implicit aria-live="polite" region) is what makes the confirmation exist for
 * anyone not looking at that corner of the screen. This badge is mounted after an async save
 * completes, and a screen reader has no reason to revisit the spot where it appears — so without a
 * live region the save was silent, and the only way to find out whether it worked was to reload
 * the page. There was no live region anywhere in the app before this.
 *
 * The tick keeps `animate-pop`, which is the one animation in the system with an overshoot curve:
 * a small bounce on a confirmation is the interface acknowledging you, and it is deliberately not
 * used for ordinary content entrances.
 */
export function SavedBadge({ text }: { text: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-1 text-[#197492] text-sm animate-slide-in-end">
      <svg className="w-4 h-4 animate-pop" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
      {text}
    </span>
  );
}

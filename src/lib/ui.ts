/**
 * Shared Tailwind class constants — previously copy-pasted byte-for-byte into
 * every page that needed them. Centralized here so a style change (or an
 * accessibility fix, like the focus-visible rings) lands once instead of N
 * times. These consume the design tokens defined in index.css (@theme), so
 * editing the accent/neutral ramps there re-skins every use site of these.
 */

/* Focus ring reused by every interactive token below — one visible, offset,
 * brand-tinted ring, applied consistently so keyboard users always see where
 * they are regardless of the control. */
const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-950";

export const inputClass =
  `w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 focus:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 ${focusRing}`;

/** Compact, non-full-width variant for inline rows (e.g. the login form). */
export const inlineInputClass =
  `rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 focus:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 ${focusRing}`;

export const primaryButtonClass =
  `inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-indigo-600 disabled:hover:shadow-sm ${focusRing}`;

export const secondaryButtonClass =
  `inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:bg-gray-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600 dark:hover:bg-gray-800 ${focusRing}`;

/** Low-emphasis, borderless action (toolbar buttons, inline "clear"/"reset"). */
export const ghostButtonClass =
  `inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100 ${focusRing}`;

/** Square icon-only button (topbar controls, card affordances). */
export const iconButtonClass =
  `inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 active:scale-[0.96] dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100 ${focusRing}`;

/** Filled, high-emphasis red button for destructive, hard-to-undo actions
 * (delete KB, uninstall plugin, delete model) -- every use site on this app
 * turned out to be genuinely destructive, so there's no separate low-emphasis
 * "danger" variant; a routine toggle (disable, not delete) uses
 * secondaryButtonClass instead. */
export const destructiveButtonClass =
  `inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-500 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-red-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-950`;

/** Base card surface -- margin/layout classes (mb-4, flex, gap-*, hover
 * variants) are call-site concerns and stay inline; only the surface itself
 * (border/bg/radius/shadow) was actually identical across every use site.
 * Now carries a hairline ring for a crisper edge on tinted backgrounds. */
export const cardClass =
  "rounded-xl border border-gray-200 bg-white p-5 shadow-sm ring-1 ring-black/[0.02] dark:border-gray-800 dark:bg-gray-900 dark:ring-white/[0.02]";

/** Interactive card (clickable/linked). Append to cardClass for hover lift. */
export const cardHoverClass =
  "transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-800";

/** Recessed inner surface (result panels, nested rows) — sits BELOW cardClass
 * visually rather than floating above the page like a card. */
export const surfaceMutedClass =
  "rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950/40";

export const badgeClass =
  "inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300";

/** Small pill used for filterable tags / explore links. */
export const chipClass =
  `inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-indigo-700 dark:hover:text-indigo-300 ${focusRing}`;

/** Keyboard-key affordance (⌘K hint, shortcut chips). */
export const kbdClass =
  "inline-flex h-5 min-w-5 items-center justify-center rounded border border-gray-300 bg-gray-50 px-1.5 font-mono text-[11px] font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400";

/** Muted secondary text (empty-state notices, inline captions). */
export const mutedTextClass = "text-sm text-gray-500 dark:text-gray-400";

/** Sub-field caption under a form control ("How many chunks to retrieve…"). */
export const fieldHintClass = "mt-0.5 text-xs text-gray-500 dark:text-gray-400";

/** The three semantic badge tones (green/amber/red, dark-mode aware). The exact
 * colour triplets were re-spelled inside confidenceBadgeColor (×2) and two
 * different statusBadgeColor helpers; this is the single source they map onto. */
export const badgeTone = {
  success: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
} as const;

/** Confidence score (0..1) → badge tone. Shared by the RAG query result panel
 * and the voice STT verify panels (previously duplicated in both, #509). */
export function confidenceBadgeColor(confidence: number): string {
  if (confidence >= 0.8) return badgeTone.success;
  if (confidence >= 0.5) return badgeTone.warn;
  return badgeTone.danger;
}

export const statusClass = (isError: boolean) =>
  `mb-4 min-h-5 text-sm ${isError ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`;

/** Small uppercase section-header label (Sidebar's nav group headings,
 * HomePage's "More to explore"). gray-500/gray-400 pairing passes WCAG AA
 * color-contrast in both themes (an earlier gray-400/gray-500 pairing did
 * not, #509). */
export const sectionLabelClass =
  "text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400";

/** Standard page entrance — a gentle rise+fade applied to each route's root so
 * navigation feels intentional rather than a hard swap. Pair with the
 * `animate-rise` keyframe from index.css. */
export const pageEnterClass = "animate-[rise_0.3s_cubic-bezier(0.22,1,0.36,1)_both]";

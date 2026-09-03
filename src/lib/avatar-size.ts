import type { AvatarSize } from "@/components/ui/Avatar";

// Single source of truth for the avatar-size vocabulary, so the Settings
// picker, the profile sheet, and every render site agree on what a member's
// stored `avatarSize` means. Previously `normalizeAvatarSize` was copy-pasted
// across six files and the pickers showed raw "xs/sm/md/lg" tokens.

const VALID_SIZES: ReadonlySet<string> = new Set<AvatarSize>([
  "xs",
  "sm",
  "md",
  "base",
  "lg",
]);

/** Coerce any stored/legacy value to a valid AvatarSize (default "md"). */
export function normalizeAvatarSize(size?: string): AvatarSize {
  return VALID_SIZES.has(size as AvatarSize) ? (size as AvatarSize) : "md";
}

/**
 * The sizes a member can choose in the UI, with friendly labels.
 * "base" is a legacy alias of "md" (both 40px) kept only for back-compat with
 * any stored value — it is intentionally NOT offered as a choice.
 */
export const AVATAR_SIZE_OPTIONS: { value: AvatarSize; label: string }[] = [
  { value: "xs", label: "Tiny" },
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
];

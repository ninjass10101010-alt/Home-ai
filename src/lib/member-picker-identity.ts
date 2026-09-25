import { selectableAvatarSize } from "@/lib/avatar-size";

export interface MemberPickerIdentity {
  pbId?: string;
  name: string;
  emoji?: string;
  color?: string;
  avatarSize: string;
  glow: boolean;
}

const PICKER_COLORS = new Set(["green", "violet", "amber", "cyan", "rose", "blue"]);
const MAX_AVATAR_CHARS = 400_000;
const DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const EXTERNAL_IMAGE_PATTERN = /^(?:https?:)?\/\/|\.(?:gif|png|jpg|jpeg|webp)(?:\?|$)/i;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeEmoji(value: unknown) {
  if (typeof value !== "string") return undefined;
  const emoji = value.trim();
  if (!emoji) return undefined;

  if (emoji.startsWith("data:")) {
    if (emoji.length > MAX_AVATAR_CHARS) return undefined;
    const match = DATA_IMAGE_PATTERN.exec(emoji);
    const payload = match?.[1];
    if (!payload) return undefined;
    const padding = payload.length - payload.replace(/=+$/, "").length;
    const remainder = payload.length % 4;
    if (remainder === 1 || (padding > 0 && remainder !== 0)) return undefined;
    return emoji;
  }

  if (EXTERNAL_IMAGE_PATTERN.test(emoji) || URI_SCHEME_PATTERN.test(emoji)) {
    return undefined;
  }
  return emoji;
}

export function sanitizeMemberPickerIdentity(value: unknown): MemberPickerIdentity | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return null;

  const identity: MemberPickerIdentity = {
    name,
    avatarSize: selectableAvatarSize(typeof value.avatarSize === "string" ? value.avatarSize : undefined),
    glow: Boolean(value.glow),
  };
  if (typeof value.pbId === "string" && value.pbId.trim()) identity.pbId = value.pbId;
  const emoji = sanitizeEmoji(value.emoji);
  const color = typeof value.color === "string" ? value.color : "";

  if (emoji) identity.emoji = emoji;
  if (PICKER_COLORS.has(color)) identity.color = color;
  return identity;
}

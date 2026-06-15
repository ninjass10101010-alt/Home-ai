export type ConnectionStatus =
  | "unconnected"
  | "waiting"
  | "connected"
  | "error:denied"
  | "error:expired"
  | "error:revoked"
  | "error:config";

export interface DeviceGrantResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenSuccess {
  status: "complete";
  access_token: string;
  refresh_token: string | null;
  id_token: string | null;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
}

export interface DeviceTokenPending {
  status: "pending";
  error: "authorization_pending" | "slow_down";
  nextInterval: number;
}

export type DevicePollResponse =
  | DeviceTokenSuccess
  | (Omit<DeviceTokenSuccess, "status"> & { status: never; error: string });

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: "Bearer";
  expires_at: number;
  account_email: string | null;
  granted_at: string;
  revoked_at: string | null;
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  etag?: string;
  updated?: string;
  htmlLink?: string;
}

export interface GoogleTaskList {
  id: string;
  title: string;
  updated?: string;
  selfLink?: string;
}

export interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  status: "needsAction" | "completed";
  due?: string;
  completed?: string;
  updated?: string;
  etag?: string;
  parent?: string;
  position?: string;
  links?: { type: string; link: string; description?: string }[];
}

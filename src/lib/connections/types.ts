/**
 * Connection Types — Shared types for the integration system.
 */

export type ConnectionStatus = "disconnected" | "connected" | "error" | "connecting";

export type ConnectionAuthType =
  | "api_key"          // Simple: user pastes a key
  | "oauth"            // Complex: redirect to provider, get token
  | "username_password" // Basic auth
  | "none";            // No auth needed (e.g., Open-Meteo)

export interface ConnectionConfig {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: ConnectionCategory;
  authType: ConnectionAuthType;
  /** Fields the user needs to fill in */
  fields: ConnectionField[];
  /** What this integration enables in the dashboard */
  features: string[];
  /** URL to get an API key / set up the service */
  setupUrl?: string;
  /** Whether this integration is available (some require paid plans) */
  available: boolean;
  /** Composer provider name (for Composio-based integrations) */
  composioProvider?: string;
}

export interface ConnectionField {
  key: string;
  label: string;
  placeholder?: string;
  type: "text" | "password" | "url" | "email";
  required: boolean;
  helpText?: string;
}

export interface ConnectionCredentials {
  [key: string]: string;
}

export interface StoredConnection {
  id: string;
  status: ConnectionStatus;
  credentials: ConnectionCredentials;
  connectedAt?: string;
  lastError?: string;
}

export type ConnectionCategory =
  | "grocery"
  | "music"
  | "maps"
  | "calendar"
  | "smart_home"
  | "communication"
  | "finance"
  | "photos"
  | "shopping"
  | "food_delivery"
  | "education";

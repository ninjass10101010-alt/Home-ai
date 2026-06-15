import { getAdminPB } from "./pb";

const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || "admin@consuela.app";
const ADMIN_PASS = process.env.PB_ADMIN_PASS || "26649_alan";

let adminToken: string | null = null;
let tokenExpiry = 0;

export async function ensureAuth(): Promise<string> {
  if (adminToken && Date.now() < tokenExpiry) return adminToken;

  const pb = getAdminPB();
  const auth = await pb.collection("_superusers").authWithPassword(ADMIN_EMAIL, ADMIN_PASS);
  adminToken = auth.token;
  tokenExpiry = Date.now() + 3600_000;
  return adminToken;
}

export async function withAdmin<T>(fn: (pb: ReturnType<typeof getAdminPB>) => Promise<T>): Promise<T> {
  const pb = getAdminPB();
  pb.authStore.save(await ensureAuth(), null);
  return fn(pb);
}

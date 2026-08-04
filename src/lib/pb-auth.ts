import { getAdminPB } from "./pb.ts";

const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASS = process.env.PB_ADMIN_PASS;

let adminToken: string | null = null;
let tokenExpiry = 0;

export async function ensureAuth(): Promise<string> {
  if (!ADMIN_EMAIL || !ADMIN_PASS) {
    throw new Error("PB_ADMIN_EMAIL and PB_ADMIN_PASS environment variables are required");
  }
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

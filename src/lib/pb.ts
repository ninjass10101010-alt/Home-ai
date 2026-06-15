import PocketBase from "pocketbase";

const PB_URL = process.env.NEXT_PUBLIC_PB_URL || "http://192.168.0.28:8090";

let pb: PocketBase | null = null;

export function getPB(): PocketBase {
  if (typeof window === "undefined") {
    return new PocketBase(PB_URL);
  }
  if (!pb) {
    pb = new PocketBase(PB_URL);
    pb.autoCancellation(false);
  }
  return pb;
}

export function getAdminPB(): PocketBase {
  const client = new PocketBase(PB_URL);
  client.autoCancellation(false);
  return client;
}

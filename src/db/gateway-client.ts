// Browser-side fetch wrapper over the sessioned DB gateway (/api/db/*).
// Used ONLY when `typeof window !== "undefined"` — server code keeps calling
// src/db/pb-db.ts directly. The gateway enforces the session cookie and the
// collection allowlist server-side; these helpers just speak its shape
// (GET list → { items }, writes → the raw row).

export async function gatewayList(collection: string, query = ""): Promise<any[]> {
  const res = await fetch(`/api/db/${collection}${query}`);
  if (!res.ok) throw new Error(`gateway_list_failed:${collection}:${res.status}`);
  return (await res.json()).items;
}

export async function gatewayCreate(collection: string, row: unknown) {
  const res = await fetch(`/api/db/${collection}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`gateway_create_failed:${collection}:${res.status}`);
  return res.json();
}

export async function gatewayUpdate(collection: string, id: string, row: unknown) {
  const res = await fetch(`/api/db/${collection}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`gateway_update_failed:${collection}:${res.status}`);
  return res.json();
}

export async function gatewayDelete(collection: string, id: string) {
  const res = await fetch(`/api/db/${collection}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`gateway_delete_failed:${collection}:${res.status}`);
}

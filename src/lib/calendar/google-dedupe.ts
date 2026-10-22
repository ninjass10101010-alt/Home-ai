export function filterMirroredFamilyRows<T extends { google_id?: string; id?: string }>(
  googleRows: T[],
  familyRows: { googleEventId?: string }[],
): T[] {
  const claimed = new Set(
    familyRows
      .map((row) => row.googleEventId)
      .filter((value): value is string => Boolean(value)),
  );
  return googleRows.filter((row) => {
    const googleId = row.google_id ?? row.id;
    return !googleId || !claimed.has(String(googleId));
  });
}

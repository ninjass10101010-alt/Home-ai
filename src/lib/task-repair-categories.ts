export const REPAIR_CATEGORY =
  /^(?:approval|projection|rollover|snapshot|week|week_archive|task|tasks)(?:[:_][a-z0-9_-]+){1,2}$/i;

export function repairCategories(values: unknown): string[] {
  const list = Array.isArray(values) ? values : [];
  return [
    ...new Set(
      list.filter(
        (value): value is string =>
          typeof value === "string" && REPAIR_CATEGORY.test(value),
      ),
    ),
  ];
}

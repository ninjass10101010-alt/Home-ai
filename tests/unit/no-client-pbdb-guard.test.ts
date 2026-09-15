// F5: the browser called pbDb for auth_sessions and always 403'd under locked
// rules. The path is gone; it must not come back.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
const src = readFileSync(resolve(__dirname, "../../src/hooks/useAuth.tsx"), "utf8");
it("useAuth does not import the server pb-db module", () => {
  expect(src).not.toMatch(/from ['"]@\/db\/pb-db['"]/);
  expect(src).not.toMatch(/AuthSession/);
});

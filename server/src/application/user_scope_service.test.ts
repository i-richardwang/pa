import { expect, test } from "bun:test";
import type { Principal } from "../contracts/principal.js";
import { ForbiddenError, InvalidRequestError } from "./errors.js";
import { createUserScopeService } from "./user_scope_service.js";

const admin: Principal = { email: "admin@x", roles: ["admin"], orgScope: "*" };
const user: Principal = { email: "user@x", roles: ["user"], orgScope: "*" };

test("用户组织权限写入只由 Application 授权并规范化", async () => {
  const writes: unknown[] = [];
  const service = createUserScopeService({
    writer: {
      setOrgScope: async (userId, orgScope) => {
        writes.push({ userId, orgScope });
      },
    },
  });
  await service.setOrgScope(admin, { userId: " u1 ", org_scope: " Aurora Labs " });
  expect(writes).toEqual([{ userId: "u1", orgScope: "Aurora Labs" }]);
  await expect(service.setOrgScope(user, { userId: "u1", org_scope: "*" })).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  await expect(service.setOrgScope(admin, { userId: " ", org_scope: "*" })).rejects.toBeInstanceOf(
    InvalidRequestError,
  );
});

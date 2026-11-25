/** 本机管理员开通账号并写入当前语义包的数据范围；未设置数据范围的账号可以登录。 */
import { openLocalAuth } from "./local_auth.js";
import { createBetterAuthUserAccountAdministration } from "../src/adapters/better_auth_user_account_administration.js";
import {
  configuredSemanticPackageDir,
  loadSemanticPackage,
} from "../src/engine/semantic_package.js";

const argv = process.argv.slice(2);
const opts = new Map<string, string>();
const accessScopeValues: string[] = [];
const positional: string[] = [];
for (const a of argv) {
  if (a.startsWith("--")) {
    const eq = a.indexOf("=");
    const key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    const value = eq >= 0 ? a.slice(eq + 1) : "";
    if (key === "data-scope") accessScopeValues.push(value.trim());
    else opts.set(key, value);
  } else {
    positional.push(a);
  }
}
const [email, password, name] = positional;
if (!email || !password) {
  console.error(
    "用法：bun run user:create -- <email> <password> [显示名] " +
      "[--admin] [--data-scope=<授权值>]... [--data-scope=*] [--with-key]",
  );
  process.exit(1);
}

const role = opts.has("admin") ? "admin" : "user";
if (accessScopeValues.includes("*") && accessScopeValues.length > 1) {
  throw new Error("--data-scope=* 不能与限定值同时使用");
}
const accessScope =
  accessScopeValues[0] === "*"
    ? ({ kind: "all" } as const)
    : {
        kind: "limited" as const,
        values: accessScopeValues.filter(Boolean),
      };
const withKey = opts.has("with-key");

const { auth, db: authDb } = await openLocalAuth();
const semanticPackage = await loadSemanticPackage(configuredSemanticPackageDir());
const accounts = createBetterAuthUserAccountAdministration(auth, semanticPackage.access_scope);
const user = await accounts.create({
  email,
  password,
  name: name ?? email.split("@")[0] ?? email,
  role,
  accessScope,
});
console.log(
  `已创建：${user.email}（id=${user.id}，角色=${role}，` +
    `数据范围=${accessScopeValues.join("、") || "（未设置：可以登录，但查不到数据）"}）`,
);

if (withKey) {
  const key = await auth.api.createApiKey({ body: { name: "onboarding", userId: user.id } });
  console.log("API Key（明文仅此一次，请妥善保管）：");
  console.log(key.key);
}
authDb.close();

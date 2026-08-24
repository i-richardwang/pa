/**
 * 类型门禁：每一份 tsconfig 过一遍 tsc，清单由 `git ls-files` 现取，不抄进 package.json。
 *
 * 编译器走本包 `node_modules/.bin/tsc`：`bunx tsc` 在没有 node_modules 的目录下会去
 * npm 现拉一个大版本不同的编译器。仓库根按本文件位置算，不问 git：pre-commit 会设
 * `GIT_DIR`，此时 `rev-parse --show-toplevel` 返回的是当前目录而非仓库根。
 *
 * 分两面（`--tests` 取用例面）：pre-commit 只跑源码面，两面合起来即全部 tsconfig。
 */
import { $ } from "bun";

const tests = process.argv.includes("--tests");
const tsc = Bun.fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url));
const root = Bun.fileURLToPath(new URL("../..", import.meta.url));
const pattern = "*tsconfig*.json"; // 变量传入，免得 bun shell 先把它当本地 glob 展开
const all = (await $`git ls-files ${pattern}`.cwd(root).text())
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

if (all.length === 0) throw new Error("仓库里一份 tsconfig 都没找到：门禁的覆盖面已经归零");

const projects = all.filter((path) => path.endsWith("tsconfig.test.json") === tests);
console.log(`typecheck${tests ? ":tests" : ""} → ${projects.join(" ")}`);

for (const project of projects) {
  const done = await $`${tsc} -p ${root}/${project} --noEmit`.nothrow();
  if (done.exitCode !== 0) process.exit(done.exitCode);
}

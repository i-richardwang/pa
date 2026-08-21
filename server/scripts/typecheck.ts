/**
 * 类型门禁：覆盖面算出来，编译器点名取。
 *
 * 仓库里每一份 tsconfig 都要过一遍 tsc，清单由 `git ls-files` 现取——清单一旦抄进
 * package.json，新工作区落地那天两边就分叉，而分叉的样子是静默零覆盖加一个绿灯。
 * 编译器走本包 `node_modules/.bin/tsc`：`bunx tsc` 在没有 node_modules 的目录下会去
 * npm 现拉一个大版本不同的编译器。
 *
 * 分两面（`--tests` 取用例面）是为让 pre-commit 只跑源码面；两面合起来即全部 tsconfig。
 */
import { $ } from "bun";

const tests = process.argv.includes("--tests");
const tsc = Bun.fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url));
const root = (await $`git rev-parse --show-toplevel`.text()).trim();
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

/**
 * 对仓库里每一份 tsconfig 运行 tsc 类型检查，清单每次由 `git ls-files` 取得，不写进 package.json。
 *
 * 使用本包的 `node_modules/.bin/tsc`：在没有 node_modules 的目录下，`bunx tsc` 会从 npm
 * 临时下载一个大版本不同的编译器。仓库根目录按本文件位置计算：pre-commit 会设置 `GIT_DIR`，
 * 这时 `rev-parse --show-toplevel` 返回的是当前目录而不是仓库根。
 *
 * 加 `--tests` 时只检查 tsconfig.test.json，不加时检查其余 tsconfig；pre-commit 只运行不加参数的那组。
 */
import { $ } from "bun";

const tests = process.argv.includes("--tests");
const tsc = Bun.fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url));
const root = Bun.fileURLToPath(new URL("../..", import.meta.url));
const pattern = "*tsconfig*.json"; // 用变量传入，避免 bun shell 把它当作本地 glob 展开
const all = (await $`git ls-files ${pattern}`.cwd(root).text())
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

if (all.length === 0) throw new Error("没有找到任何 tsconfig，检查范围为空");

const projects = all.filter((path) => path.endsWith("tsconfig.test.json") === tests);
console.log(`typecheck${tests ? ":tests" : ""} → ${projects.join(" ")}`);

for (const project of projects) {
  const done = await $`${tsc} -p ${root}/${project} --noEmit`.nothrow();
  if (done.exitCode !== 0) process.exit(done.exitCode);
}

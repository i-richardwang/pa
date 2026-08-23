/**
 * Python 用例门禁：覆盖面算出来，逐个跑。
 *
 * 清单由 `git ls-files` 现取——抄进 package.json 的那一份，会在下一个用例文件落地
 * 那天与仓库分叉，而分叉的样子是静默零覆盖加一个绿灯。两种命名都收：`test_*.py`
 * 与 `*_test.py`，取仓库现有写法的并集，免得改名即失覆盖；pathspec 的 `*` 跨目录，
 * 但要匹配整条路径，所以前缀式另加一条带目录的写法。
 *
 * 每个文件用 `uv run` 单独起：脚本各自在头部声明依赖（PEP 723），没有共享虚拟环境。
 */
import { $ } from "bun";

const root = Bun.fileURLToPath(new URL("../..", import.meta.url));
const patterns = ["test_*.py", "*/test_*.py", "*_test.py"];
const files = new Set<string>();
for (const pattern of patterns) {
  const listed = await $`git ls-files ${pattern}`.cwd(root).text();
  for (const line of listed.split("\n")) {
    const path = line.trim();
    if (path) files.add(path);
  }
}

if (files.size === 0) throw new Error("仓库里一个 Python 用例文件都没找到：门禁的覆盖面已经归零");

const paths = [...files].sort();
console.log(`test:python → ${paths.join(" ")}`);

for (const path of paths) {
  const done = await $`uv run ${path}`.cwd(root).nothrow();
  if (done.exitCode !== 0) process.exit(done.exitCode);
}

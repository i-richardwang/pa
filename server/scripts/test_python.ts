/**
 * Python 用例门禁：清单由 `git ls-files` 现取，不抄进 package.json。
 * `test_*.py` 与 `*_test.py` 两种命名都收；pathspec 的 `*` 跨目录但要匹配整条路径，
 * 故前缀式另加一条带目录的写法。
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

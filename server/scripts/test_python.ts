/**
 * 运行仓库里的全部 Python 测试。文件清单每次由 `git ls-files` 取得，不写进 package.json。
 * `test_*.py` 和 `*_test.py` 两种命名都包括；git pathspec 的 `*` 要匹配完整路径，
 * 所以 `test_*` 前缀形式另加一条带目录的模式。
 *
 * 每个文件用 `uv run` 单独运行：各脚本在文件头声明自己的依赖（PEP 723），没有共享的虚拟环境。
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

if (files.size === 0) throw new Error("没有找到任何 Python 测试文件，检查范围为空");

const paths = [...files].sort();
console.log(`test:python → ${paths.join(" ")}`);

for (const path of paths) {
  const done = await $`uv run ${path}`.cwd(root).nothrow();
  if (done.exitCode !== 0) process.exit(done.exitCode);
}

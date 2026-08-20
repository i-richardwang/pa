import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { lstat, readdir, readlink, realpath, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_VERSION } from "./contracts/product_metadata.js";

const root = new URL("../../", import.meta.url);
const rootPath = fileURLToPath(root);

const skillFactSource = "plugins/pa/skills/pa-analytics/SKILL.md";
const skillQueryPatterns = "plugins/pa/skills/pa-analytics/references/query_patterns.md";
const skillDomainGuardrails = "plugins/pa/skills/pa-analytics/references/domain_guardrails.md";
const agentsSkillEntry = ".agents/skills/pa-analytics/SKILL.md";
const claudeSkillEntry = ".claude/skills/pa-analytics/SKILL.md";
const claudeSkillReferences = ".claude/skills/pa-analytics/references";
const consumerReadmeTemplate = "templates/consumer/readme.md";
const consumerSkillReadmeTemplate = "templates/consumer/skill_readme.md";
const consumerCursorTemplate = "templates/consumer/cursor_mcp.json";

const containsDemoBusinessLiteral = (source: string): boolean =>
  /["'](?:workforce|headcount_plan|survey|q12)["']/i.test(source);

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() &&
        (path.endsWith(".ts") || path.endsWith(".tsx")) &&
        !path.endsWith(".test.ts") &&
        !path.endsWith(".test.tsx")
        ? [path]
        : [];
    }),
  );
  return nested.flat();
}

test("CLAUDE.md remains a short pointer to the canonical AGENTS.md", async () => {
  const claude = await readFile(new URL("CLAUDE.md", root), "utf8");
  expect(claude).toBe(
    "# Claude Code repository entry\n\n" +
      "Repository-wide instructions have a single source of truth: [`AGENTS.md`](./AGENTS.md).\n" +
      "Read and follow it before changing this repository. Do not add repository rules here; update\n" +
      "`AGENTS.md` instead.\n",
  );
});

test("repository hooks reference the canonical instruction entry", async () => {
  const hook = await readFile(new URL(".githooks/pre-commit", root), "utf8");
  expect(hook).toContain("AGENTS.md");
  expect(hook).not.toContain("CLAUDE.md");
});

test("package and runtime expose one first-release version", async () => {
  const packageMetadata = JSON.parse(
    await readFile(new URL("server/package.json", root), "utf8"),
  ) as {
    version: string;
  };
  expect(packageMetadata.version).toBe(PRODUCT_VERSION);
});

test("通用 BI 核心不内置 Demo 业务时间源或调研类型", async () => {
  const directories = ["semantic_core", "engine", "adapters", "application"];
  const files = (
    await Promise.all(
      directories.map((directory) => sourceFiles(join(rootPath, "server", "src", directory))),
    )
  ).flat();
  expect(files.length).toBeGreaterThan(0);
  expect(containsDemoBusinessLiteral('const source = "survey";')).toBe(true);
  expect(containsDemoBusinessLiteral('const source = "inventory_count";')).toBe(false);
  const violations: string[] = [];
  for (const path of files) {
    if (containsDemoBusinessLiteral(await readFile(path, "utf8"))) {
      violations.push(relative(rootPath, path));
    }
  }
  expect(violations).toEqual([]);
});

test("应用库只有 composition root 与 app_database 可以打开连接", async () => {
  const files = await sourceFiles(join(rootPath, "server", "src"));
  const callers: string[] = [];
  for (const path of files) {
    if ((await readFile(path, "utf8")).includes("openSqlite(")) {
      callers.push(relative(rootPath, path));
    }
  }
  expect(callers.sort()).toEqual([
    "server/src/index.ts",
    "server/src/sqlite.ts",
    "server/src/storage/app_database.ts",
  ]);
});

test("Better Auth 用户元数据写入只存在于 UserScope adapter", async () => {
  const marker = "internalAdapter.updateUser(";
  expect(`context.${marker}`).toContain(marker);
  const files = (
    await Promise.all([
      sourceFiles(join(rootPath, "server", "src")),
      sourceFiles(join(rootPath, "server", "scripts")),
    ])
  ).flat();
  const callers: string[] = [];
  for (const path of files) {
    if ((await readFile(path, "utf8")).includes(marker)) callers.push(relative(rootPath, path));
  }
  expect(callers).toEqual(["server/src/adapters/better_auth_user_scope.ts"]);
});

test("报告更新动作只有一个领域定义，各呈现面只引用共享子集", async () => {
  const canonical = await readFile(new URL("server/src/contracts/report_action.ts", root), "utf8");
  expect(
    canonical.includes('z.literal("replace_view")'),
    "检测串已无法命中唯一合法定义，护栏失去检出能力",
  ).toBe(true);

  const productionFiles = (
    await Promise.all([
      sourceFiles(join(rootPath, "server", "src")),
      sourceFiles(join(rootPath, "server", "console", "src")),
    ])
  ).flat();
  const duplicateDefinitions: string[] = [];
  for (const path of productionFiles) {
    const relativePath = relative(rootPath, path);
    if (relativePath === "server/src/contracts/report_action.ts") continue;
    const source = await readFile(path, "utf8");
    if (source.includes('z.literal("replace_view")')) duplicateDefinitions.push(relativePath);
  }
  expect(duplicateDefinitions).toEqual([]);

  const service = await readFile(new URL("server/src/application/report_service.ts", root), "utf8");
  const webReportContract = await readFile(
    new URL("server/src/contracts/report_contract.ts", root),
    "utf8",
  );
  const mcpTools = await readFile(new URL("server/src/mcp/report_tools.ts", root), "utf8");
  const identity = await readFile(new URL("server/src/contracts/report_identity.ts", root), "utf8");
  expect(service).toContain('from "../contracts/report_action.js"');
  expect(webReportContract).toContain("WEB_REPORT_UPDATE_ACTION");
  expect(mcpTools).toContain("MCP_REPORT_UPDATE_ACTION");
  expect(identity).toContain("export const REPORT_NAME_SCHEMA");

  const nameSchemaDefinitions: string[] = [];
  for (const path of productionFiles) {
    if ((await readFile(path, "utf8")).includes("export const REPORT_NAME_SCHEMA")) {
      nameSchemaDefinitions.push(relative(rootPath, path));
    }
  }
  expect(nameSchemaDefinitions).toEqual(["server/src/contracts/report_identity.ts"]);
});

test("pa-analytics skill has a single editable fact source in the plugin", async () => {
  const factStat = await stat(new URL(skillFactSource, root));
  expect(factStat.isFile()).toBe(true);
});

test("pa-analytics is not also shipped as a standalone .agents skill", async () => {
  const strayEntry = await lstat(new URL(agentsSkillEntry, root)).catch(() => null);
  expect(strayEntry, `${agentsSkillEntry} 与插件事实源重复分发`).toBeNull();
});

test("Claude Code skill entry is a symlink, not a copied SKILL.md", async () => {
  const entryStat = await lstat(new URL(claudeSkillEntry, root));
  expect(entryStat.isSymbolicLink()).toBe(true);
});

test("Claude Code skill entry resolves to the plugin fact source", async () => {
  const resolved = await realpath(new URL(claudeSkillEntry, root));
  const factResolved = await realpath(new URL(skillFactSource, root));
  expect(resolved).toBe(factResolved);
});

test("Claude Code skill references resolve to the plugin fact source", async () => {
  const entryStat = await lstat(new URL(claudeSkillReferences, root));
  expect(entryStat.isSymbolicLink()).toBe(true);
  const resolved = await realpath(new URL(claudeSkillReferences, root));
  const factResolved = await realpath(new URL("plugins/pa/skills/pa-analytics/references", root));
  expect(resolved).toBe(factResolved);
});

function trackedSymlinks(): string[] {
  const output = execFileSync("git", ["ls-files", "--stage", "-z"], {
    cwd: rootPath,
  });
  const entries: string[] = [];
  for (const record of output.toString("utf8").split("\0")) {
    if (record === "") continue;
    const tabIdx = record.indexOf("\t");
    if (tabIdx === -1) continue;
    const meta = record.slice(0, tabIdx);
    const path = record.slice(tabIdx + 1);
    const mode = meta.split(" ")[0];
    if (mode !== "120000") continue;
    entries.push(path);
  }
  return entries;
}

test("pa-analytics 教学采用唯一 sink 交付模型", async () => {
  const patterns = await readFile(new URL(skillQueryPatterns, root), "utf8");
  for (const marker of ["唯一", "sink", "provenance", "多次 `run_analysis`"]) {
    expect(patterns.includes(marker), `query_patterns 缺唯一 sink 交付模型标记「${marker}」`).toBe(
      true,
    );
  }
});

test("记录投影教学使用唯一领域语言", async () => {
  const skill = await readFile(new URL(skillFactSource, root), "utf8");
  expect(skill).toContain("records_available: true");
  expect(skill).toContain("show_records");
});

test("pa-analytics 领域教学只引用业务标题与公共协议，不教授物理选路名", async () => {
  const guardrails = await readFile(new URL(skillDomainGuardrails, root), "utf8");
  const modelRoot = new URL("demo/model/", root);
  const modelFiles = (
    await Promise.all(
      ["cubes", "views"].map(async (directory) =>
        (
          await readdir(new URL(`${directory}/`, modelRoot))
        )
          .filter((name) => name.endsWith(".yml"))
          .map((name) => new URL(`${directory}/${name}`, modelRoot)),
      ),
    )
  ).flat();
  const physicalNames = new Set<string>();
  for (const file of modelFiles) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/^\s*- name:\s*([a-z][a-z0-9_]*)\s*$/gm)) {
      physicalNames.add(match[1]);
    }
  }
  for (const name of physicalNames) {
    const physical = `\`${name}\``;
    expect(guardrails.includes(physical), `领域教学泄漏物理标识 ${physical}`).toBe(false);
  }
  expect(guardrails).toContain("成员 id 以本次");
  expect(guardrails).toContain("目录标题为“组织”");
});

test("pa-analytics 教学使用正式指标与 Breakdown 排名契约", async () => {
  const skill = await readFile(new URL(skillFactSource, root), "utf8");
  const patterns = await readFile(new URL(skillQueryPatterns, root), "utf8");
  const corpus = `${skill}\n${patterns}`;
  const pinnedCutoff = /"cutoff": "20\d{2}-\d{2}"/;
  expect(pinnedCutoff.test('"cutoff": "2026-07"'), "探针必须能发现写死的截止月").toBe(true);
  expect(pinnedCutoff.test('"cutoff": "<YYYY-MM>"'), "探针不得误报占位写法").toBe(false);
  expect(patterns).not.toMatch(pinnedCutoff);
  for (const marker of [
    "group_sort: {dimension:",
    "同一业务时间坐标",
    "不同时间语义",
    "同一业务桶上按指标语义求值",
    "正式指标合同自动规划",
    "最新逻辑输出桶",
  ]) {
    expect(corpus.includes(marker), `pa-analytics 教学缺契约标记「${marker}」`).toBe(true);
  }
});

test("消费目录模板只保留接入文件，不复制查询教程或 Agent 入口", async () => {
  const readme = await readFile(new URL(consumerReadmeTemplate, root), "utf8");
  const skillReadme = await readFile(new URL(consumerSkillReadmeTemplate, root), "utf8");
  const cursor = await readFile(new URL(consumerCursorTemplate, root), "utf8");
  const corpus = `${readme}\n${skillReadme}`;
  const templates = await readdir(new URL("templates/consumer", root));
  for (const duplicatedProtocol of ["run_analysis", "group_sort:", "query_patterns"]) {
    expect(
      corpus.includes(duplicatedProtocol),
      `消费目录模板复制了 Skill 协议「${duplicatedProtocol}」`,
    ).toBe(false);
  }
  expect(corpus).toContain("pa-analytics");
  expect(corpus).toContain("工具 Schema");
  expect(templates.sort()).toEqual(["cursor_mcp.json", "readme.md", "skill_readme.md"]);
  expect(cursor).toContain("Bearer $" + "{env:PA_MCP_API_KEY}");
  expect(cursor).not.toMatch(/Bearer pa_[A-Za-z0-9]+/);
});

test("插件同步发布消费模板", async () => {
  const script = await readFile(new URL("scripts/sync_consumer_plugin.sh", root), "utf8");
  for (const expected of [
    'rsync -a --delete "$SOURCE_PLUGIN/" "$DEST_PLUGIN/"',
    'cp "$SOURCE_MARKETPLACE" "$DEST_MARKETPLACE"',
    'cp "$SOURCE_TEMPLATES/readme.md" "$DEST_ROOT/README.md"',
    'cp "$SOURCE_TEMPLATES/cursor_mcp.json" "$DEST_ROOT/.cursor/mcp.json"',
    'rm -f "$DEST_ROOT/AGENTS.md" "$DEST_ROOT/CLAUDE.md"',
  ]) {
    expect(script.includes(expected), `插件同步缺少消费目录动作：${expected}`).toBe(true);
  }
});

test("every git-tracked symlink target exists", async () => {
  const entries = trackedSymlinks();
  expect(entries.length).toBeGreaterThan(0);
  for (const path of entries) {
    const linkAbs = join(rootPath, path);
    const linkStat = await lstat(linkAbs);
    expect(linkStat.isSymbolicLink()).toBe(true);
    const target = await readlink(linkAbs);
    const resolved = await realpath(linkAbs).catch(() => null);
    expect(resolved, `dangling symlink: ${path} -> ${target}`).not.toBeNull();
    const targetStat = await stat(linkAbs).catch(() => null);
    expect(targetStat, `missing symlink target: ${path} -> ${target}`).not.toBeNull();
  }
});

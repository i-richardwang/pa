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
const skillDeliveryWorkflows = "plugins/pa/skills/pa-analytics/references/delivery_workflows.md";
const agentsSkillEntry = ".agents/skills/pa-analytics/SKILL.md";
const claudeSkillEntry = ".claude/skills/pa-analytics/SKILL.md";
const claudeSkillReferences = ".claude/skills/pa-analytics/references";

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

test("CLAUDE.md only points contributors to the canonical AGENTS.md", async () => {
  const claude = await readFile(new URL("CLAUDE.md", root), "utf8");
  expect(claude).toContain("[`AGENTS.md`](./AGENTS.md)");
  expect(claude.match(/^#/gm)).toHaveLength(1);
  expect(claude.trim().split("\n").length).toBeLessThanOrEqual(8);
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

test("Better Auth 授权持久化只由用户账号适配器编码", async () => {
  const marker = "access_scope: serializeAccessScope(";
  expect(`${marker}scope, definition.id)`).toContain(marker);
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
  expect(callers).toEqual(["server/src/adapters/better_auth_user_account_administration.ts"]);
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

/** Skill 语料 = 入口加全部按需读取件；泄漏类检查一律对整份语料生效，不逐文件列举。 */
async function skillCorpus(): Promise<string> {
  const parts = await Promise.all(
    [skillFactSource, skillQueryPatterns, skillDeliveryWorkflows].map((path) =>
      readFile(new URL(path, root), "utf8"),
    ),
  );
  return parts.join("\n");
}

test("pa-analytics entry links every conditional workflow", async () => {
  const skill = await readFile(new URL(skillFactSource, root), "utf8");
  expect(skill).toContain("references/query_patterns.md");
  expect(skill).toContain("references/delivery_workflows.md");
});

test("record projection safety workflow remains available to the skill", async () => {
  const delivery = await readFile(new URL(skillDeliveryWorkflows, root), "utf8");
  expect(delivery).toContain("records_available: true");
  expect(delivery).toContain("show_records");
  expect(delivery).toContain("不在回复中复述姓名、工号或其他逐人字段");
});

test("pa-analytics instructions do not expose physical model names", async () => {
  const corpus = await skillCorpus();
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
    expect(corpus.includes(physical), `PA Skill 泄漏物理标识 ${physical}`).toBe(false);
  }
});

test("pa-analytics instructions do not pin a data cutoff", async () => {
  const corpus = await skillCorpus();
  const pinnedCutoff = /"cutoff": "20\d{2}-\d{2}"/;
  expect(pinnedCutoff.test('"cutoff": "2026-07"'), "探针必须能发现写死的截止月").toBe(true);
  expect(pinnedCutoff.test('"cutoff": "<YYYY-MM>"'), "探针不得误报占位写法").toBe(false);
  expect(corpus).not.toMatch(pinnedCutoff);
});

test("PA 插件是自有边界完整的公共制品", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("plugins/pa/.codex-plugin/plugin.json", root), "utf8"),
  ) as { name: string; skills: string; mcpServers: string };
  const mcp = await readFile(new URL("plugins/pa/.mcp.json", root), "utf8");
  const marketplace = await readFile(new URL(".agents/plugins/marketplace.json", root), "utf8");
  expect(manifest).toMatchObject({ name: "pa", skills: "./skills/", mcpServers: "./.mcp.json" });
  expect(mcp).toContain("http://127.0.0.1:8788/mcp");
  expect(mcp).not.toContain("8789");
  expect(marketplace).toContain('"path": "./plugins/pa"');
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

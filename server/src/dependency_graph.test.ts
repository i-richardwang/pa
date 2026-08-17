/** 生产模块依赖图：用 TypeScript 解析与解析器配置守护零循环和端口方向。 */
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SERVER = fileURLToPath(new URL("../", import.meta.url));
const REPO = resolve(SERVER, "..");

type SourceRoot = {
  path: string;
  options: ts.CompilerOptions;
};

function compilerOptions(configPath: string): ts.CompilerOptions {
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) {
    throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  }
  return ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(configPath)).options;
}

const roots: SourceRoot[] = [
  { path: join(SERVER, "src"), options: compilerOptions(join(SERVER, "tsconfig.json")) },
  {
    path: join(SERVER, "console", "src"),
    options: compilerOptions(join(SERVER, "console", "tsconfig.json")),
  },
  {
    path: join(SERVER, "result_view", "src"),
    options: compilerOptions(join(SERVER, "result_view", "tsconfig.json")),
  },
  {
    path: join(SERVER, "widget", "src"),
    options: compilerOptions(join(SERVER, "widget", "tsconfig.json")),
  },
  {
    path: join(SERVER, "scripts"),
    options: compilerOptions(join(SERVER, "scripts", "tsconfig.json")),
  },
];

function productSources(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .filter((name) => !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"))
    .filter((name) => !name.endsWith(".d.ts") && !name.startsWith(`test_support${sep}`))
    .map((name) => resolve(root, name));
}

const files = roots.flatMap(({ path }) => productSources(path));
const fileSet = new Set(files);

function rootFor(file: string): SourceRoot {
  const root = roots.find(({ path }) => file === path || file.startsWith(`${path}${sep}`));
  if (!root) throw new Error(`找不到 ${file} 的 TypeScript 工程`);
  return root;
}

function moduleSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    ts.sys.readFile(file) ?? "",
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function dependencies(file: string): string[] {
  const { options } = rootFor(file);
  return moduleSpecifiers(file).flatMap((specifier) => {
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
    if (!resolved) return [];
    const target = resolve(resolved.resolvedFileName);
    return fileSet.has(target) ? [target] : [];
  });
}

const graph = new Map(files.map((file) => [file, dependencies(file)]));
const display = (file: string) => relative(REPO, file);

function cycles(): string[][] {
  const complete = new Set<string>();
  const active = new Map<string, number>();
  const stack: string[] = [];
  const found: string[][] = [];

  const visit = (file: string): void => {
    if (complete.has(file)) return;
    const previous = active.get(file);
    if (previous !== undefined) {
      found.push([...stack.slice(previous), file].map(display));
      return;
    }
    active.set(file, stack.length);
    stack.push(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
    stack.pop();
    active.delete(file);
    complete.add(file);
  };

  for (const file of files) visit(file);
  return found;
}

test("生产 TypeScript 模块依赖图无循环", () => {
  expect(cycles()).toEqual([]);
});

test("端口只依赖 ports 与纯源码边界", () => {
  const portRoot = join(SERVER, "src", "ports");
  const approvedRoots = [
    portRoot,
    join(SERVER, "src", "contracts"),
    join(SERVER, "src", "semantic_core"),
    join(SERVER, "src", "presentation_core"),
  ];
  const violations = files
    .filter((file) => file.startsWith(`${portRoot}${sep}`))
    .flatMap((file) =>
      (graph.get(file) ?? [])
        .filter(
          (dependency) => !approvedRoots.some((root) => dependency.startsWith(`${root}${sep}`)),
        )
        .map((dependency) => `${display(file)} -> ${display(dependency)}`),
    );
  expect(violations).toEqual([]);
});

test("前端宿主只通过 result_view 公开包复用结果视图", () => {
  const consoleRoot = join(SERVER, "console", "src");
  const widgetRoot = join(SERVER, "widget", "src");
  const resultViewRoot = join(SERVER, "result_view", "src");
  const violations = files.flatMap((file) => {
    const forbiddenRoots = file.startsWith(`${consoleRoot}${sep}`)
      ? [widgetRoot]
      : file.startsWith(`${resultViewRoot}${sep}`)
        ? [consoleRoot, widgetRoot]
        : [];
    return (graph.get(file) ?? [])
      .filter((dependency) => forbiddenRoots.some((root) => dependency.startsWith(`${root}${sep}`)))
      .map((dependency) => `${display(file)} -> ${display(dependency)}`);
  });
  expect(violations).toEqual([]);

  const publicEntry = join(resultViewRoot, "index.ts");
  const publicConsumers = files
    .filter((file) => (graph.get(file) ?? []).includes(publicEntry))
    .map(display)
    .sort();
  expect(publicConsumers).toContain("server/console/src/dashboard/analyses/analysis_workbench.tsx");
  expect(publicConsumers).toContain("server/widget/src/components/result_card.tsx");
});

test("源码核心包保持 semantic → presentation → contracts 单向装配", () => {
  const semanticRoot = join(SERVER, "src", "semantic_core");
  const presentationRoot = join(SERVER, "src", "presentation_core");
  const contractsRoot = join(SERVER, "src", "contracts");
  const allowed = new Map<string, string[]>([
    [semanticRoot, [semanticRoot]],
    [presentationRoot, [presentationRoot, semanticRoot]],
    [contractsRoot, [contractsRoot, presentationRoot, semanticRoot]],
  ]);
  const violations = files.flatMap((file) => {
    const entry = [...allowed.entries()].find(([root]) => file.startsWith(`${root}${sep}`));
    if (!entry) return [];
    const [, roots] = entry;
    return (graph.get(file) ?? [])
      .filter(
        (dependency) =>
          dependency.startsWith(`${join(SERVER, "src")}${sep}`) &&
          !roots.some((root) => dependency.startsWith(`${root}${sep}`)),
      )
      .map((dependency) => `${display(file)} -> ${display(dependency)}`);
  });
  expect(violations).toEqual([]);
});

test("result_view 只依赖公开源码核心", () => {
  const serverRoot = resolve(SERVER);
  const resultViewRoot = join(SERVER, "result_view", "src");
  const approvedRoots = [
    resultViewRoot,
    join(SERVER, "src", "contracts"),
    join(SERVER, "src", "semantic_core"),
    join(SERVER, "src", "presentation_core"),
  ];
  const violations = files
    .filter((file) => file.startsWith(`${resultViewRoot}${sep}`))
    .flatMap((file) =>
      (graph.get(file) ?? [])
        .filter(
          (dependency) =>
            dependency.startsWith(`${serverRoot}${sep}`) &&
            !approvedRoots.some((root) => dependency.startsWith(`${root}${sep}`)),
        )
        .map((dependency) => `${display(file)} -> ${display(dependency)}`),
    );
  expect(violations).toEqual([]);
});

test("application services 与 transports 不依赖存储实现", () => {
  const storageRoot = join(SERVER, "src", "storage");
  const applicationRoot = join(SERVER, "src", "application");
  const dashboardRoot = join(SERVER, "src", "dashboard");
  const mcpRoot = join(SERVER, "src", "mcp");
  const applicationRuntime = join(applicationRoot, "runtime.ts");
  const subjects = files.filter(
    (file) =>
      (file.startsWith(`${applicationRoot}${sep}`) && file !== applicationRuntime) ||
      file.startsWith(`${dashboardRoot}${sep}`) ||
      file.startsWith(`${mcpRoot}${sep}`) ||
      file === join(SERVER, "src", "server.ts"),
  );
  const violations = subjects.flatMap((file) =>
    (graph.get(file) ?? [])
      .filter((dependency) => dependency.startsWith(`${storageRoot}${sep}`))
      .map((dependency) => `${display(file)} -> ${display(dependency)}`),
  );
  expect(violations).toEqual([]);
});

test("engine 不创建或反向依赖存储实现", () => {
  const engineRoot = join(SERVER, "src", "engine");
  const storageRoot = join(SERVER, "src", "storage");
  const violations = files
    .filter((file) => file.startsWith(`${engineRoot}${sep}`))
    .flatMap((file) =>
      (graph.get(file) ?? [])
        .filter((dependency) => dependency.startsWith(`${storageRoot}${sep}`))
        .map((dependency) => `${display(file)} -> ${display(dependency)}`),
    );
  expect(violations).toEqual([]);
});

test("SQLite 业务适配器只由 composition roots 创建", () => {
  const implementations = new Set([
    join(SERVER, "src", "storage", "analysis_repository.ts"),
    join(SERVER, "src", "storage", "audit.ts"),
    join(SERVER, "src", "storage", "board_repository.ts"),
    join(SERVER, "src", "storage", "business_term_repository.ts"),
    join(SERVER, "src", "storage", "feedback.ts"),
    join(SERVER, "src", "storage", "export_ticket.ts"),
    join(SERVER, "src", "storage", "record_projection_audit.ts"),
    join(SERVER, "src", "storage", "report_repository.ts"),
    join(SERVER, "src", "storage", "usage_log.ts"),
    join(SERVER, "src", "storage", "usage_stats.ts"),
  ]);
  const compositionRoots = new Set([
    join(SERVER, "src", "application", "runtime.ts"),
    join(SERVER, "src", "index.ts"),
  ]);
  const productionServiceRoot = join(SERVER, "src");
  const violations = files.flatMap((file) =>
    (file.startsWith(`${productionServiceRoot}${sep}`) ? (graph.get(file) ?? []) : [])
      .filter((dependency) => implementations.has(dependency) && !compositionRoots.has(file))
      .map((dependency) => `${display(file)} -> ${display(dependency)}`),
  );
  expect(violations).toEqual([]);
});

test("Cube HTTP 实现只由 composition roots 创建", () => {
  const implementation = join(SERVER, "src", "adapters", "cube_gateway.ts");
  const consumers = files
    .filter((file) => (graph.get(file) ?? []).includes(implementation))
    .map(display)
    .sort();
  expect(consumers).toEqual([
    "server/scripts/access_policy_smoke.ts",
    "server/scripts/record_projection_smoke.ts",
    "server/scripts/seed_demo.ts",
    "server/scripts/time_eval.ts",
    "server/src/index.ts",
  ]);
});

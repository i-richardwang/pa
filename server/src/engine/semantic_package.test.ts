import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuredSemanticPackageDir, loadSemanticPackage } from "./semantic_package.js";

test("默认公开包通过版本、分类和模型目录校验", async () => {
  const semanticPackage = await loadSemanticPackage(configuredSemanticPackageDir({}));
  expect(semanticPackage).toMatchObject({ schema_version: 1, id: "pa_demo" });
  expect(semanticPackage.formal_metrics.length).toBeGreaterThan(0);
  expect(semanticPackage.taxonomy.metric_domains.length).toBeGreaterThan(0);
});

test("模型路径不能离开包目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "pa-semantic-package-"));
  const manifest = await readFile(
    join(configuredSemanticPackageDir({}), "semantic_package.yml"),
    "utf8",
  );
  await writeFile(
    join(root, "semantic_package.yml"),
    manifest.replace("model_path: model", "model_path: ../model"),
  );
  await expect(loadSemanticPackage(root)).rejects.toThrow("不得离开包目录");
});

test("缺少模型目录或重复身份时 fail-closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "pa-semantic-package-"));
  const manifest = await readFile(
    join(configuredSemanticPackageDir({}), "semantic_package.yml"),
    "utf8",
  );
  await writeFile(join(root, "semantic_package.yml"), manifest);
  await expect(loadSemanticPackage(root)).rejects.toThrow("缺少模型目录 cubes");

  await mkdir(join(root, "model", "cubes"), { recursive: true });
  await mkdir(join(root, "model", "views"), { recursive: true });
  await writeFile(
    join(root, "semantic_package.yml"),
    manifest.replace(
      "    - id: metric_domain:workforce_movement",
      "    - id: metric_domain:workforce_structure",
    ),
  );
  await expect(loadSemanticPackage(root)).rejects.toThrow("metric_domains.id 不得重复");
});

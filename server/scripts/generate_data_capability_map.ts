/**
 * 从当前语义包的 YAML 声明生成 Demo 能力地图参考夹具；模型调整后重跑。
 * 该夹具只供纯前端与投影漂移测试。
 */
import { writeFile } from "node:fs/promises";
import { projectDataCapabilityMap } from "../src/presentation_core/data_capability_map.js";
import {
  configuredSemanticPackageDir,
  loadSemanticModelCatalog,
  loadSemanticPackage,
} from "../src/engine/semantic_package.js";

const semanticPackage = await loadSemanticPackage(configuredSemanticPackageDir());
const outPath = new URL(
  "../console/src/dashboard/catalog/data_capability_map_data.json",
  import.meta.url,
);

const catalog = await loadSemanticModelCatalog(semanticPackage);
const capabilityMap = projectDataCapabilityMap(catalog);
await writeFile(outPath, `${JSON.stringify(capabilityMap, null, 2)}\n`);
console.log(
  `data capability map: ${capabilityMap.facts.length} facts / ${capabilityMap.dimension_groups.length} dimension groups / ${capabilityMap.metric_domains.length} metric domains -> ${outPath}`,
);

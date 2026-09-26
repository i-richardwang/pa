/**
 * 根据当前语义包的 YAML 生成 Demo 能力地图的参考数据文件，修改模型后需要重新运行。
 * 这个文件只用于前端测试和能力地图投影的一致性测试。
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

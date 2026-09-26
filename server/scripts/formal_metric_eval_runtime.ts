import { createCubeGateway } from "../src/adapters/cube_gateway.js";
import { config } from "../src/config.js";
import { SERVICE_CUBE_CONTEXT } from "../src/engine/cube_security.js";
import { withFormalMetricModel } from "../src/engine/formal_metric_gateway.js";
import { executeMetricQuery } from "../src/engine/metric_executor.js";
import { metricPlanLeafQueries, planMetricQuery } from "../src/engine/metric_planner.js";
import {
  configuredSemanticPackageDir,
  loadSemanticPackage,
} from "../src/engine/semantic_package.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function createFormalMetricEvalRuntime() {
  const semanticPackage = await loadSemanticPackage(configuredSemanticPackageDir());
  const cube = withFormalMetricModel(
    createCubeGateway({
      cubeUrl: config.cubeUrl,
      apiSecret: config.apiSecret,
      accessScopeId: semanticPackage.access_scope.id,
      serviceContext: SERVICE_CUBE_CONTEXT,
      timeSources: semanticPackage.time_sources,
    }),
    semanticPackage.formal_metrics,
  );
  const views = await cube.meta(SERVICE_CUBE_CONTEXT);
  const context = await cube.timeContext();

  async function execute(measures: string[], timeView?: string) {
    const plan = planMetricQuery(
      { measures },
      { cutoff: context.dataAsOf },
      context,
      views,
      timeView ? { timeView } : {},
    );
    for (const leaf of metricPlanLeafQueries(plan)) {
      const prefixes = new Set(
        [...(leaf.query.measures ?? []), ...(leaf.query.dimensions ?? [])].map(
          (member) => member.split(".")[0],
        ),
      );
      assert(prefixes.size <= 1, "一条 Cube 子查询里混入了多个事实来源");
    }
    const result = await executeMetricQuery(cube, plan, SERVICE_CUBE_CONTEXT, views);
    return { plan, row: result.data[0] ?? {} };
  }

  return { semanticPackage, execute };
}

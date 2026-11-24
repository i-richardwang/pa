import { createCubeGateway } from "../src/adapters/cube_gateway.js";
import { createObservationDirectory } from "../src/application/observation_directory.js";
import { selectObservations } from "../src/application/observation_execution.js";
import { config } from "../src/config.js";
import { SERVICE_CUBE_CONTEXT } from "../src/engine/cube_security.js";
import { withFormalMetricModel } from "../src/engine/formal_metric_gateway.js";
import { executeMetricQuery } from "../src/engine/metric_executor.js";
import { metricPlanLeafQueries, planMetricQuery } from "../src/engine/metric_planner.js";
import type { CubeQuery } from "../src/ports/cube_gateway.js";
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

  const occurrences = createObservationDirectory({
    cube,
    security: SERVICE_CUBE_CONTEXT,
    views,
    sources: semanticPackage.time_sources,
  });
  async function execute(measures: string[], timeView?: string) {
    const view = views.find(({ name }) => name === timeView);
    const sourceId = view?.meta?.time_source;
    const observation =
      typeof sourceId === "string" && semanticPackage.time_sources.by_id.get(sourceId)?.observation;
    let cutoff = context.dataAsOf;
    let filters: CubeQuery["filters"];
    if (observation && view && typeof sourceId === "string") {
      const sequence = await occurrences.sequence(sourceId);
      const { periods } = selectObservations(sequence, { cutoff }, context.sources[sourceId]);
      const actual = periods[0]?.occurrence;
      assert(actual, "截止月之前没有可核验的调研期次");
      cutoff = actual.date.slice(0, 7);
      filters = [
        {
          member: `${view.name}.${observation.id_member}`,
          operator: "equals",
          values: [actual.id],
        },
      ];
    }
    const plan = planMetricQuery(
      { measures, filters },
      { cutoff },
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

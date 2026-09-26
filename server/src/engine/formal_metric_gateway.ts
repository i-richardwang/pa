/** 正式指标叠加在按权限裁剪后的物理模型上；Cube 适配器只返回物理模型。 */
import type { CubeGateway } from "../ports/cube_gateway.js";
import { applyFormalMetricModel, type FormalMetricDefinition } from "./metric_model.js";

export function withFormalMetricModel(
  gateway: CubeGateway,
  formalMetrics: readonly FormalMetricDefinition[],
): CubeGateway {
  return {
    ...gateway,
    async meta(context) {
      return applyFormalMetricModel(await gateway.meta(context), formalMetrics);
    },
  };
}

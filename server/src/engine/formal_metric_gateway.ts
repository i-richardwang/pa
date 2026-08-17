/** 把正式指标图叠加到权限裁剪后的物理模型；外部 Cube 适配器不认识业务指标。 */
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

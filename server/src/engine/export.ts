/**
 * export 通道：模型只接触短而不透明的限时下载票据，CSV 下载时惰性执行——不落文件；
 * 票据只存已规划查询与签发时的 Cube securityContext 快照，不复制数据。
 */
import type { ExportAuditEvent } from "../ports/export_audit.js";
import type { CubeGateway, CubeSecurityContext } from "../ports/cube_gateway.js";
import type {
  ExportTicketClaims as TicketClaims,
  ExportTicketRepository,
} from "../ports/export_ticket_repository.js";
import { memberDisplayTitle } from "./member_presentation.js";
import type { ExportLink, ExportResourceLink } from "../semantic_core/query_payload.js";
import { executeBoundedMetricQuery } from "./metric_executor.js";
import { metricOutputMembers, type MetricQueryPlan } from "./metric_planner.js";
import { applyValueOrder } from "./value_order.js";

/** Cube REST /v1/load 的默认行上限即 50000，导出档位顶格使用 */
export const EXPORT_MAX_ROWS = 50000;

export const EXPORT_RESOURCE_URI_TEMPLATE = "pa://export/{ticket}";
export const EXPORT_RESOURCE_MIME_TYPE = "text/csv; charset=utf-8";

export type ExportDelivery = {
  link: ExportLink;
  resource: ExportResourceLink;
};

/**
 * 执行导出计划并装配 CSV。与分析执行服务复用同一指标计划、结果计算与序数维度排序——
 * 三处出口（文本/预览/CSV）同数同序。列头与预览卡片共用规范化成员名。
 *
 * 导出恒按服务端顶格预算执行。触顶导出上限时置 complete=false：引擎上限即 50000，
 * 无法多取探测，触顶即完整性不可确认——由路由拒绝交付
 * （不完整名单被当完整名单用是错数，宁缺）。
 */
export async function runExport(
  cube: CubeGateway,
  plan: MetricQueryPlan,
  securityContext: CubeSecurityContext,
): Promise<{ csv: string; rowCount: number; asOf: string; complete: boolean }> {
  const cap = EXPORT_MAX_ROWS;
  const views = await cube.meta(securityContext);
  const bounded = await executeBoundedMetricQuery(cube, plan, securityContext, views, cap);
  const res = bounded.load;
  const memberKeys = res.data.length ? Object.keys(res.data[0]) : metricOutputMembers(plan);
  const titles = new Map(
    [...Object.entries(res.annotation.measures), ...Object.entries(res.annotation.dimensions)].map(
      ([name, a]) => [name, memberDisplayTitle(views, name, a.title)],
    ),
  );
  const records = applyValueOrder(
    res.data,
    { dimensions: plan.dimensions, order: plan.order },
    views,
  );
  const delivered = records.slice(0, cap);
  const columns = memberKeys.map((k) => titles.get(k) ?? k);
  const rows = delivered.map((r) =>
    memberKeys.map((k) => (r[k] ?? null) as string | number | null),
  );
  const asOf = await cube
    .timeContext()
    .then((context) => context.dataAsOf)
    .catch(() => "unknown");
  return {
    csv: toCsv(columns, rows),
    rowCount: rows.length,
    asOf,
    complete: bounded.complete,
  };
}

/** 触顶上限时拒绝把不完整 CSV 交付为完整结果。 */
export class ExportIncompleteError extends Error {
  constructor(readonly rowCount: number) {
    super(`结果达到导出上限（${rowCount} 行），完整性无法确认`);
    this.name = "ExportIncompleteError";
  }
}

export type ExportRuntime = ReturnType<typeof createExportRuntime>;
export type ExportTicketClaims = TicketClaims<MetricQueryPlan>;

export function createExportRuntime(input: {
  tickets: ExportTicketRepository<MetricQueryPlan>;
  baseUrl: string;
  cube: CubeGateway;
  audit: (event: ExportAuditEvent) => Promise<void>;
}) {
  async function createDelivery(
    plan: MetricQueryPlan,
    caller: string,
    securityContext: CubeSecurityContext,
  ): Promise<ExportDelivery> {
    const ticket = await input.tickets.create(plan, caller, securityContext);
    return {
      link: {
        url: `${input.baseUrl}/export/${ticket.id}`,
        expires_at: ticket.expires_at,
      },
      resource: {
        type: "resource_link",
        uri: `pa://export/${ticket.id}`,
        name: "pa_export.csv",
        mimeType: EXPORT_RESOURCE_MIME_TYPE,
      },
    };
  }

  async function createLink(
    plan: MetricQueryPlan,
    caller: string,
    securityContext: CubeSecurityContext,
  ): Promise<ExportLink> {
    return (await createDelivery(plan, caller, securityContext)).link;
  }

  async function materialize(claims: ExportTicketClaims): Promise<{
    csv: string;
    rowCount: number;
    asOf: string;
  }> {
    try {
      const result = await runExport(input.cube, claims.plan, claims.securityContext);
      if (!result.complete) {
        await input
          .audit({
            event: "export_failed",
            caller: claims.caller,
            query: claims.plan,
            row_count: result.rowCount,
          })
          .catch(() => {});
        throw new ExportIncompleteError(result.rowCount);
      }
      await input.audit({
        event: "export_downloaded",
        caller: claims.caller,
        query: claims.plan,
        row_count: result.rowCount,
      });
      return result;
    } catch (error) {
      if (!(error instanceof ExportIncompleteError)) {
        await input
          .audit({
            event: "export_failed",
            caller: claims.caller,
            query: claims.plan,
          })
          .catch(() => {});
      }
      throw error;
    }
  }

  return {
    createDelivery,
    createLink,
    resolveTicket: input.tickets.resolve,
    materialize,
  };
}

/** RFC 4180 CSV；UTF-8 BOM 供 Excel 直开中文 */
export function toCsv(columns: string[], rows: (string | number | null)[][]): string {
  const escapeCsv = (v: string | number | null): string => {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const bom = "\uFEFF";
  return `${bom}${[columns, ...rows].map((r) => r.map(escapeCsv).join(",")).join("\r\n")}\r\n`;
}

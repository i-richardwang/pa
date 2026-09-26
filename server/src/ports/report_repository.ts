import type { RenderShape } from "../presentation_core/render_shape.js";

export type ReportRecord = {
  id: string;
  owner: string;
  name: string;
  view_id: string;
  /** 所有者最近一次重新执行时解析出的布局提示，下次执行会覆盖。 */
  render_shape: RenderShape | null;
  archived_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type ReportRevision = {
  report_id: string;
  revision: number;
  name: string;
  view_id: string;
  saved_by: string;
  saved_at: string;
};

export class ReportNotFoundError extends Error {}
export class ReportConflictError extends Error {}

/** `all` 包含已归档报告，供种子脚本按名称匹配已有记录。 */
export type ReportListScope = "active" | "archived" | "all";

export type ReportRepository = {
  create(input: { owner: string; name: string; viewId: string }): Promise<ReportRecord>;
  get(id: string): Promise<ReportRecord | null>;
  resolveOwned(id: string, owner: string): Promise<ReportRecord>;
  listOwned(owner: string, query?: string, scope?: ReportListScope): Promise<ReportRecord[]>;
  update(
    id: string,
    owner: string,
    patch: { name?: string; viewId?: string; archivedAt?: string | null },
    ifRevision?: number,
  ): Promise<ReportRecord>;
  listRevisions(id: string, owner: string): Promise<ReportRevision[]>;
  restore(id: string, owner: string, revision: number, ifRevision?: number): Promise<ReportRecord>;
  cacheRenderShape(id: string, viewId: string, shape: RenderShape | null): Promise<void>;
};

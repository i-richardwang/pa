import type { Place } from "../contracts/board_contract.js";

/** 存储态瓦片不复制报告名称与呈现信息。 */
export type StoredTile =
  | { kind: "report"; tile_id: string; report_id: string; place: Place }
  | { kind: "text"; tile_id: string; md: string; place: Place };

export type BoardRecord = {
  id: string;
  name: string;
  tiles: StoredTile[];
  created_by: string;
  /** 非 null 时从清单隐藏，置回 null 即恢复；记录与瓦片不删除。 */
  archived_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

export class BoardConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardConflictError";
  }
}

export type BoardRepository = {
  create(name: string, createdBy: string): Promise<BoardRecord>;
  get(id: string): Promise<BoardRecord | null>;
  /** `all` 包含已归档看板，供种子脚本按名称匹配已有记录；界面使用 active。 */
  list(scope?: "active" | "all"): Promise<BoardRecord[]>;
  update(
    id: string,
    patch: { name?: string; tiles?: StoredTile[] },
    ifRevision: number,
  ): Promise<BoardRecord | null>;
  archive(id: string): Promise<boolean>;
  restore(id: string): Promise<boolean>;
};

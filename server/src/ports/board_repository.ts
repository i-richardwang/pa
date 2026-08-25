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
  /** 置时间戳即从清单撤下，置回 null 即复原；记录与瓦片不销毁。 */
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
  /** `all` 只给播种这类需要连已删除的一起认领的场合；界面恒取 active。 */
  list(scope?: "active" | "all"): Promise<BoardRecord[]>;
  update(
    id: string,
    patch: { name?: string; tiles?: StoredTile[] },
    ifRevision: number,
  ): Promise<BoardRecord | null>;
  archive(id: string): Promise<boolean>;
  restore(id: string): Promise<boolean>;
};

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
  list(): Promise<BoardRecord[]>;
  update(
    id: string,
    patch: { name?: string; tiles?: unknown },
    ifRevision: number,
  ): Promise<BoardRecord | null>;
  remove(id: string): Promise<boolean>;
};

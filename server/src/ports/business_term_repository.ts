export type StoredBusinessTerm = {
  id: string;
  /** 删除可逆：置时间戳即从词典撤下（检索也不再命中），置回 null 即复原。 */
  archived_at: string | null;
  canonical_term: string;
  definition: string;
  context: string | null;
  aliases: string[];
  related_member_ids: string[];
};

export type NormalizedBusinessTermContent = {
  canonical_term: string;
  definition: string;
  context?: string;
  aliases: string[];
  related_member_ids: string[];
};

export class BusinessTermNotFoundError extends Error {}

export type BusinessTermRepository = {
  list(): Promise<StoredBusinessTerm[]>;
  get(id: string): Promise<StoredBusinessTerm | null>;
  create(input: NormalizedBusinessTermContent): Promise<StoredBusinessTerm>;
  replace(id: string, input: NormalizedBusinessTermContent): Promise<StoredBusinessTerm>;
  archive(id: string): Promise<StoredBusinessTerm>;
  restore(id: string): Promise<StoredBusinessTerm>;
};

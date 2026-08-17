export type StoredBusinessTerm = {
  id: string;
  canonical_term: string;
  definition: string;
  context: string | null;
  aliases: string[];
  related_member_ids: string[];
};

export type BusinessTermContent = {
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
  create(input: BusinessTermContent): Promise<StoredBusinessTerm>;
  replace(id: string, input: BusinessTermContent): Promise<StoredBusinessTerm>;
  remove(id: string): Promise<StoredBusinessTerm>;
};

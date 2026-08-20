export type UserScopeWriter = {
  setOrgScope(userId: string, orgScope: string): Promise<void>;
};

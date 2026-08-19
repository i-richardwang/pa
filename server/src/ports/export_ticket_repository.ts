export type ExportTicketClaims<Plan> = {
  plan: Plan;
  caller: string;
};

export type ExportTicketRepository<Plan> = {
  create(plan: Plan, caller: string): Promise<{ id: string; expires_at: string }>;
  resolve(id: string): Promise<ExportTicketClaims<Plan> | null>;
};

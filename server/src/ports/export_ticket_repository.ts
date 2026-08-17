import type { CubeSecurityContext } from "./cube_gateway.js";

export type ExportTicketClaims<Plan> = {
  plan: Plan;
  caller: string;
  securityContext: CubeSecurityContext;
  exp: number;
};

export type ExportTicketRepository<Plan> = {
  create(
    plan: Plan,
    caller: string,
    securityContext: CubeSecurityContext,
  ): Promise<{ id: string; expires_at: string }>;
  resolve(id: string): Promise<ExportTicketClaims<Plan> | null>;
};

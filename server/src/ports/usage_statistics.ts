import type {
  MyAnalysesPayload,
  UnansweredPayload,
  UsageOverviewPayload,
  UsageTitlesPayload,
} from "../contracts/dashboard_contract.js";

export type UsageStatistics = {
  overview(days: number): Promise<UsageOverviewPayload>;
  titles(days: number, limit?: number, offset?: number): Promise<UsageTitlesPayload>;
  mine(caller: string, days: number, limit?: number, offset?: number): Promise<MyAnalysesPayload>;
  unanswered(days: number): Promise<UnansweredPayload>;
};

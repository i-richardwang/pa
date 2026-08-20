import type { MyAnalysesPayload } from "../contracts/analysis_contract.js";
import type {
  UnansweredPayload,
  UsageOverviewPayload,
  UsageTitlesPayload,
} from "../contracts/usage_contract.js";

export type UsageStatistics = {
  overview(days: number): Promise<UsageOverviewPayload>;
  titles(days: number, limit: number, offset: number): Promise<UsageTitlesPayload>;
  mine(caller: string, days: number, limit: number, offset: number): Promise<MyAnalysesPayload>;
  unanswered(days: number): Promise<UnansweredPayload>;
};

import { expect, test } from "bun:test";
import type { ReplayPayload } from "@contracts/replay_contract";
import type { ReportDetail } from "@contracts/report_contract";
import { reportKeys, revisionsConsistent } from "./editor_queries";

test("重放键位不含 revision：含了它就得等详情落地才发得出去，白串一跳", () => {
  expect(reportKeys.detail("r1")).toEqual(["report", "r1"]);
  expect(reportKeys.replay("r1")).toEqual(["report_replay", "r1"]);
  expect(reportKeys.revisions("r1")).toEqual(["report_revisions", "r1"]);
  // 键位只认 id：同一份报告的重放在任何版本下都是同一个键，保存后的换新由 resetQueries 办
  expect(reportKeys.replay("r1")).toHaveLength(2);
  expect(reportKeys.replay("r1")).not.toEqual(reportKeys.replay("r2"));
});

const report = (revision: number) => ({ revision }) as ReportDetail;
const replay = (revision: number | undefined) => ({ revision }) as ReplayPayload;

test("重放版本与报告详情一致时对账通过", () => {
  expect(revisionsConsistent(report(4), replay(4))).toBe(true);
});

test("两次取数跨版本时对账失败，触发拉回最新详情", () => {
  expect(revisionsConsistent(report(4), replay(5))).toBe(false);
});

test("临时预览无 revision，不参与报告版本对账", () => {
  expect(revisionsConsistent(report(4), replay(undefined))).toBe(true);
});

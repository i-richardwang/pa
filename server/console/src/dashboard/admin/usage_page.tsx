/** 管理员日志页与 scripts/usage_report.py 消费同一 usage_log。 */
import { type ReactNode, useState } from "react";
import type {
  UnansweredPayload,
  UsageOverviewPayload,
  UsageTitlesPayload,
} from "@contracts/usage_contract";
import { LoadingMark } from "pa-result-view";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Frame } from "@/components/ui/frame";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorText, formatAt } from "../api";
import { useUsage } from "../dashboard_queries";
import { ListControlBar, ListPageBody, ListScrollBody } from "../layout/layout_chrome";
import { EmptyPanel } from "../kit/empty_panel";
import { DaysRangeChips, ListFacets } from "../kit/table_kit";
import { type UsageFacet, usageHash } from "../router";
import { TablePager } from "../kit/table_pager";

const TOOL_LABELS: Record<string, string> = {
  catalog: "目录检索",
  values_of: "维度取值",
  run_analysis: "运行分析",
  rerun_analysis: "重新呈现",
  show_analysis: "展示分析",
  report_replay: "重放报告",
  save_report: "保存报告",
  update_report: "更新报告",
  find_report: "查找报告",
  export_result: "导出结果",
  board: "看板变更",
  feedback: "反馈",
};

const USAGE_FACETS: ReadonlyArray<{ value: UsageFacet; label: string; hash: string }> = [
  { value: "titles", label: "业务问题", hash: usageHash("titles") },
  { value: "stats", label: "调用统计", hash: usageHash("stats") },
  { value: "unanswered", label: "未解决的问题", hash: usageHash("unanswered") },
];

export function UsagePage({ facet }: { facet: UsageFacet }) {
  const [days, setDays] = useState<number>(30);
  const [offset, setOffset] = useState(0);

  const usageQuery = useUsage(days, offset);
  const data = usageQuery.data ?? null;
  const loading = usageQuery.isFetching;
  const error = errorText(usageQuery.error);

  return (
    <ListPageBody>
      <ListControlBar
        left={<ListFacets label="视图" options={USAGE_FACETS} value={facet} />}
        right={
          <DaysRangeChips
            days={days}
            onDays={(next) => {
              setDays(next);
              setOffset(0);
            }}
          />
        }
      />
      <ListScrollBody>
        <div className="space-y-6">
          {error && (
            <Alert variant="error">
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          {loading && !data && <LoadingMark className="py-16" />}
          {data && (
            <div className={loading ? "space-y-6 opacity-60" : "space-y-6"}>
              <OverviewCards overview={data.overview} />
              {facet === "titles" && (
                <TitlesCard titles={data.titles} offset={offset} onOffset={setOffset} />
              )}
              {facet === "stats" && (
                <div className="space-y-6">
                  <VolumeCard overview={data.overview} />
                  <CallersCard overview={data.overview} />
                </div>
              )}
              {facet === "unanswered" && (
                <div className="space-y-6">
                  <ZeroHitsCard unanswered={data.unanswered} />
                  <ErrorsCard unanswered={data.unanswered} />
                </div>
              )}
            </div>
          )}
        </div>
      </ListScrollBody>
    </ListPageBody>
  );
}

function OverviewCards({ overview }: { overview: UsageOverviewPayload }) {
  const total = overview.cells.reduce((s, c) => s + c.n, 0);
  const errors = overview.cells.filter((c) => c.outcome === "error").reduce((s, c) => s + c.n, 0);
  const stats = [
    { label: "总调用", value: total },
    { label: "报错", value: errors },
    { label: "调用者", value: overview.callers.length },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {stats.map((s) => (
        <Card key={s.label}>
          <CardHeader>
            <CardDescription>{s.label}</CardDescription>
            <CardTitle className="text-xl tabular-nums">{s.value}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

/** 分面只有一张表时不传 title。 */
function TableSection({
  title,
  description,
  children,
}: {
  title?: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        {title ? <h3 className="font-semibold text-md">{title}</h3> : null}
        <p className="text-pa-muted text-sm">{description}</p>
      </div>
      <Frame>{children}</Frame>
    </section>
  );
}

function VolumeCard({ overview }: { overview: UsageOverviewPayload }) {
  return (
    <TableSection title="调用量" description="按工具 × 结果聚合">
      {overview.cells.length === 0 ? (
        <EmptyPanel text="所选时间范围内暂无调用" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>工具</TableHead>
              <TableHead>结果</TableHead>
              <TableHead className="text-right">次数</TableHead>
              <TableHead className="text-right">有截断</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.cells.map((c) => (
              <TableRow key={`${c.tool}-${c.outcome}`}>
                <TableCell>{toolLabel(c.tool)}</TableCell>
                <TableCell>
                  {/* 成功用中性徽标，只有报错用彩色状态徽标。 */}
                  {c.outcome === "ok" ? <Badge>成功</Badge> : <Badge variant="error">报错</Badge>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.n}</TableCell>
                <TableCell className="text-right tabular-nums">{c.truncated || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableSection>
  );
}

function CallersCard({ overview }: { overview: UsageOverviewPayload }) {
  return (
    <TableSection title="调用者" description="API key 用户或 OAuth 账号">
      {overview.callers.length === 0 ? (
        <EmptyPanel text="所选时间范围内暂无调用" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>调用者</TableHead>
              <TableHead className="text-right">次数</TableHead>
              <TableHead className="text-right">最近调用</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.callers.map((c) => (
              <TableRow key={c.caller}>
                <TableCell>{c.caller}</TableCell>
                <TableCell className="text-right tabular-nums">{c.n}</TableCell>
                <TableCell className="text-pa-muted text-right tabular-nums">
                  {formatAt(c.last_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableSection>
  );
}

function TitlesCard({
  titles,
  offset,
  onOffset,
}: {
  titles: UsageTitlesPayload;
  offset: number;
  onOffset: (offset: number) => void;
}) {
  return (
    <TableSection description="查询时填写的问题原文">
      {titles.rows.length === 0 ? (
        <EmptyPanel text="所选时间范围内没有带问题原文的查询。如果一直为空，请检查 Agent 是否按 Skill 说明传入 title" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">时间</TableHead>
              <TableHead className="w-40">调用者</TableHead>
              <TableHead>问题</TableHead>
              <TableHead className="w-24 text-right">结果</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {titles.rows.map((r, i) => (
              <TableRow key={`${r.at}-${i}`}>
                <TableCell className="text-pa-muted tabular-nums">{formatAt(r.at)}</TableCell>
                <TableCell className="max-w-40 truncate">{r.caller}</TableCell>
                <TableCell>{r.title}</TableCell>
                <TableCell className="text-right">
                  <span className="tabular-nums">{r.row_count ?? "—"} 行</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {titles.rows.length > 0 && (
        <TablePager total={titles.total} offset={offset} onOffset={onOffset} />
      )}
    </TableSection>
  );
}

function ZeroHitsCard({ unanswered }: { unanswered: UnansweredPayload }) {
  return (
    <TableSection
      title="零命中检索"
      description="搜索过但目录中没有匹配结果的词，可能是目录缺少的内容"
    >
      {unanswered.zero_hits.length === 0 ? (
        <EmptyPanel text="所选时间范围内没有零命中的检索" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>检索词</TableHead>
              <TableHead className="text-right">次数</TableHead>
              <TableHead className="text-right">最近出现</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unanswered.zero_hits.map((r) => (
              <TableRow key={r.term}>
                <TableCell>「{r.term}」</TableCell>
                <TableCell className="text-right tabular-nums">{r.n}</TableCell>
                <TableCell className="text-pa-muted text-right tabular-nums">
                  {formatAt(r.last_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableSection>
  );
}

function ErrorsCard({ unanswered }: { unanswered: UnansweredPayload }) {
  return (
    <TableSection title="报错调用" description="按报错文本汇总，例如引用了目录中不存在的指标或维度">
      {unanswered.errors.length === 0 ? (
        <EmptyPanel text="所选时间范围内没有报错" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">工具</TableHead>
              <TableHead>报错</TableHead>
              <TableHead className="w-56">原始问题</TableHead>
              <TableHead className="w-16 text-right">次数</TableHead>
              <TableHead className="w-28 text-right">最近出现</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unanswered.errors.map((r, i) => (
              <TableRow key={`${r.tool}-${i}`}>
                <TableCell>{toolLabel(r.tool)}</TableCell>
                <TableCell className="max-w-md" title={r.error}>
                  <p className="truncate">{r.error}</p>
                </TableCell>
                <TableCell className="max-w-56 text-pa-muted">
                  {r.example_title ? (
                    <p className="truncate" title={r.example_title}>
                      {r.example_title}
                    </p>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.n}</TableCell>
                <TableCell className="text-pa-muted text-right tabular-nums">
                  {formatAt(r.last_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableSection>
  );
}

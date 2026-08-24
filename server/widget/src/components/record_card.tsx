import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { ActionButton } from "pa-result-view";
import type { RecordProjectionPayload } from "@records";

/**
 * 名单卡：清单表判据与控制台同源，本包只引 pa-result-view。
 */

export function RecordCard({
  payload,
  status,
  loading,
  fullscreen,
  canFullscreen,
  onPage,
  onFullscreen,
}: {
  payload: RecordProjectionPayload | null;
  status: string;
  loading: boolean;
  fullscreen: boolean;
  canFullscreen: boolean;
  onPage: (offset: number) => Promise<void>;
  onFullscreen: () => Promise<void>;
}) {
  const frame = fullscreen ? "mx-auto w-full max-w-7xl" : "";
  if (!payload) {
    return (
      <div className={frame}>
        <div className="flex h-44 items-center justify-center rounded-md border border-pa-line bg-pa-bg">
          <p className="px-4 text-pa-muted">{status}</p>
        </div>
      </div>
    );
  }

  const first = payload.rows.length ? payload.offset + 1 : 0;
  const last = payload.offset + payload.rows.length;
  const previous = Math.max(0, payload.offset - payload.page_size);

  return (
    <div className={frame}>
      <div className="overflow-hidden rounded-md border border-pa-line bg-pa-bg">
        <header className="flex flex-wrap items-start justify-between gap-3 border-pa-line border-b px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="font-medium text-base text-pa-fg">{payload.record_set_title}</h2>
              <span className="text-pa-muted text-xs">来自「{payload.metric_title}」</span>
            </div>
            <p className="mt-1 text-pa-muted text-xs">{payload.record_set_description}</p>
          </div>
          {canFullscreen && !fullscreen ? (
            <ActionButton onClick={() => void onFullscreen()}>
              <Maximize2 />
              全屏
            </ActionButton>
          ) : null}
        </header>

        {payload.data_changed ? (
          <div className="border-pa-line-subtle border-b bg-pa-surface px-4 py-2 text-pa-muted text-xs">
            数据已刷新，名单按当前数据重新计算（截至 {payload.data_as_of}）。
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {payload.columns.map((column, index) => (
                  <th
                    className="whitespace-nowrap bg-pa-bg p-2 text-left align-middle font-normal text-pa-faint"
                    key={`${payload.column_keys[index] ?? index}:${column}`}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payload.rows.map((row, rowIndex) => (
                <tr
                  className="border-pa-line border-t hover:bg-pa-wash"
                  key={payload.offset + rowIndex}
                >
                  {row.map((value, columnIndex) => (
                    <td
                      className="whitespace-nowrap px-2 py-3 text-pa-fg"
                      key={payload.column_keys[columnIndex] ?? columnIndex}
                    >
                      {value ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!payload.rows.length ? (
            <div className="px-4 py-12 text-center text-pa-muted">当前口径下没有构成记录。</div>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-pa-muted text-xs">
          <div>
            {first ? `显示第 ${first}–${last} 条` : "0 条记录"}
            {payload.limit_reached ? " · 已达到名单浏览上限，请缩小筛选范围" : ""}
            {status && !loading ? ` · ${status}` : ""}
          </div>
          <div className="flex items-center gap-2">
            <ActionButton
              disabled={loading || payload.offset === 0}
              onClick={() => void onPage(previous)}
            >
              <ChevronLeft />
              上一页
            </ActionButton>
            <ActionButton
              disabled={loading || !payload.has_more}
              onClick={() => void onPage(payload.offset + payload.page_size)}
            >
              下一页
              <ChevronRight />
            </ActionButton>
          </div>
        </footer>
      </div>
    </div>
  );
}

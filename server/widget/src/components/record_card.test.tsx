import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordCard } from "./record_card.js";
import type { RecordProjectionPayload } from "@records";

const payload: RecordProjectionPayload = {
  metric_id: "hr.active_employee_count",
  metric_title: "在职人数",
  record_set_title: "在职人员名单",
  record_set_description: "口径内的每一位在职员工",
  columns: ["姓名", "组织"],
  column_keys: ["employee_name", "organization_name"],
  rows: [
    ["张三", "研发"],
    ["李四", "市场"],
  ],
  offset: 0,
  page_size: 50,
  has_more: false,
  data_as_of: "2026-08-01",
  data_changed: false,
};

const render = (override: Partial<RecordProjectionPayload> = {}) =>
  renderToStaticMarkup(
    <RecordCard
      canFullscreen={false}
      fullscreen={false}
      loading={false}
      onFullscreen={() => Promise.resolve()}
      onPage={() => Promise.resolve()}
      payload={{ ...payload, ...override }}
      status=""
    />,
  );

test("表头不加粗，文字颜色比单元格浅", () => {
  const head = render().match(/<th\s[^>]*>/)?.[0] ?? "";
  expect(head).toContain("font-normal");
  expect(head).toContain("text-pa-faint");
  expect(head).not.toContain("font-medium");
});

test("行分隔线只画在每行顶部，最后一行下方没有边框", () => {
  const table = render().match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";
  const rows = table.match(/<tr class="[^"]*"/g) ?? [];
  expect(rows.length).toBe(payload.rows.length);
  for (const row of rows) expect(row).toContain("border-t");
  expect(table).not.toContain("border-b");
});

test("所有单元格使用同一文字颜色且左对齐", () => {
  const cells = render().match(/<td[^>]*>/g) ?? [];
  expect(cells.length).toBe(4);
  for (const cell of cells) {
    expect(cell).toContain("text-pa-fg");
    expect(cell).not.toContain("text-pa-muted");
    expect(cell).not.toContain("text-right");
  }
});

test("卡片标题比正文大一号，使用 medium 字重", () => {
  const title = render().match(/<h2\s[^>]*>/)?.[0] ?? "";
  expect(title).toContain("text-base");
  expect(title).toContain("font-medium");
  expect(title).not.toContain("font-semibold");
});

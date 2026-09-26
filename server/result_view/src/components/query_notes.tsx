/**
 * 口径说明：结果的用户可见口径；派生结果的来源和公式也作为一条。
 * 只在结果卡中显示，默认收起、可展开（QueryNotesDetails）；看板瓦片和控制台整页不显示。
 */
import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import type { QueryPayload } from "../../../src/semantic_core/query_payload.js";

type QueryNote = { member: string; title: string; text: string };

function queryNotes(payload: QueryPayload): QueryNote[] {
  const seen = new Set<string>();
  const view = payload.view;
  return [
    ...(view.provenance
      ? [
          {
            member: `provenance:${view.id}`,
            title: `${view.view_title ?? "分析结果"}来源与公式`,
            text: `${view.provenance.sources.map((source) => source.title).join("、")}；${view.provenance.formula}`,
          },
        ]
      : []),
    ...(view.display_notes ?? []),
  ].filter((n) => {
    const key = `${n.member}|${n.text}`;
    if (!n.text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function QueryNotesDetails({ payload }: { payload: QueryPayload }) {
  const [open, setOpen] = useState(false);
  const notes = queryNotes(payload);
  if (!notes.length) return null;
  return (
    <div>
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-sm"
        onClick={() => setOpen(!open)}
      >
        口径说明
        <ChevronDownIcon className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="flex flex-col gap-1 py-2 text-pa-muted text-sm">
          {notes.map((n) => (
            <li key={`${n.member}|${n.text}`}>
              <span className="font-medium text-pa-fg">{n.title}</span>
              {`：${n.text}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

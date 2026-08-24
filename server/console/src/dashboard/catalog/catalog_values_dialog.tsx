/**
 * 关键词交给服务端过滤（Cube contains），本地不截值：
 * 截断上限由服务端裁决并随 truncated 文案透出。
 */
import { useEffect, useState } from "react";
import { CircleAlertIcon, InboxIcon, SearchIcon } from "lucide-react";
import { LoadingMark } from "pa-result-view";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { errorText } from "../api";
import { useDimensionValues } from "../dashboard_queries";

export type ValuesTarget = { member: string; title: string };

export function CatalogValuesDialog({
  target,
  onClose,
}: {
  target: ValuesTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{target?.title ?? "维度取值"}</DialogTitle>
          <DialogDescription className="sr-only">搜索可用取值</DialogDescription>
        </DialogHeader>
        {/* key 锚定维度，确保过滤词与结果不会跨维度复用。 */}
        {target && <ValuesBody key={target.member} member={target.member} />}
      </DialogPopup>
    </Dialog>
  );
}

function ValuesBody({ member }: { member: string }) {
  const [contains, setContains] = useState("");
  const [query, setQuery] = useState("");

  // 输入防抖：击键不直打 Cube。
  useEffect(() => {
    const timer = setTimeout(() => setQuery(contains.trim()), 300);
    return () => clearTimeout(timer);
  }, [contains]);

  const valuesQuery = useDimensionValues(member, query);
  const data = valuesQuery.data ?? null;
  const loading = valuesQuery.isFetching;
  const error = errorText(valuesQuery.error);

  return (
    <DialogPanel className="flex flex-col gap-3">
      <InputGroup>
        <InputGroupInput
          aria-label="过滤取值"
          onChange={(e) => setContains(e.target.value)}
          placeholder="输入关键词缩小范围"
          type="search"
          value={contains}
        />
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
      </InputGroup>
      {error ? (
        <Alert variant="error">
          <CircleAlertIcon />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      ) : !data ? (
        <LoadingMark className="h-64" />
      ) : (
        <div className={loading ? "flex flex-col gap-2 opacity-60" : "flex flex-col gap-2"}>
          {data.values.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <InboxIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {query ? `没有包含「${query}」的取值` : "你的权限范围内暂无取值"}
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ScrollArea className="h-64 rounded-sm border">
              <div className="flex flex-col gap-1 px-4 py-2">
                {data.values.map((value) => (
                  <p className="text-sm" key={value}>
                    {value}
                  </p>
                ))}
              </div>
            </ScrollArea>
          )}
          {data.truncated && <p className="text-pa-muted text-xs">{data.truncated}</p>}
        </div>
      )}
    </DialogPanel>
  );
}

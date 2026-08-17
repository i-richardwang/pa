/**
 * 无界日志列表使用服务端 limit/offset 分页，total 来自同一窗口的 COUNT。
 * 分页器只呈现区间和导航，不在浏览器中持有或切分完整结果集。
 */
import { Button } from "@/components/ui/button";
import { FrameFooter } from "@/components/ui/frame";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DASHBOARD_PAGE_SIZE } from "@contract";

export function TablePager({
  total,
  offset,
  onOffset,
}: {
  /** 当前查询窗口内的总条数，不是当前页行数。 */
  total: number;
  offset: number;
  onOffset: (offset: number) => void;
}) {
  const pageCount = Math.max(Math.ceil(total / DASHBOARD_PAGE_SIZE), 1);
  const pageIndex = Math.min(Math.floor(offset / DASHBOARD_PAGE_SIZE), pageCount - 1);
  const ranges = Array.from({ length: pageCount }, (_, i) => ({
    label: `${i * DASHBOARD_PAGE_SIZE + 1}-${Math.min((i + 1) * DASHBOARD_PAGE_SIZE, total)}`,
    value: i + 1,
  }));

  return (
    // FrameFooter 恒为 justify-end（动作靠右）；分页器要的是两端分置，
    // 故内层显式 w-full 撑满，否则会被父级压成内容宽度并整体挤到右缘。
    <FrameFooter className="pt-2">
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <p className="text-pa-muted text-sm">查看</p>
          <Select
            items={ranges}
            onValueChange={(v) => onOffset(((v as number) - 1) * DASHBOARD_PAGE_SIZE)}
            value={pageIndex + 1}
          >
            <SelectTrigger aria-label="选择记录区间" className="w-auto" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {ranges.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <p className="text-pa-muted text-sm">
            共 <strong className="font-medium text-pa-fg">{total}</strong> 条
          </p>
        </div>
        <Pagination className="justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                className="sm:*:[svg]:hidden"
                render={
                  <Button
                    disabled={pageIndex <= 0}
                    onClick={() => onOffset((pageIndex - 1) * DASHBOARD_PAGE_SIZE)}
                    variant="default"
                  />
                }
              />
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                className="sm:*:[svg]:hidden"
                render={
                  <Button
                    disabled={pageIndex >= pageCount - 1}
                    onClick={() => onOffset((pageIndex + 1) * DASHBOARD_PAGE_SIZE)}
                    variant="default"
                  />
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </FrameFooter>
  );
}

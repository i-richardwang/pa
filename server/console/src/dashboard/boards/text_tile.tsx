import { ArrowDownIcon, ArrowUpIcon, EllipsisIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuDangerGroup, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { Textarea } from "@/components/ui/textarea";
import { TextMarkdown } from "../kit/text_markdown";
import { TileShell, tileEditMenuTriggerClass } from "./tile_shell";

export function TextTile({
  md,
  editing,
  interacting,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onChangeMd,
  onRemove,
}: {
  md: string;
  editing: boolean;
  interacting: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onChangeMd: (md: string) => void;
  onRemove?: () => void;
}) {
  return (
    <TileShell
      title={<span className="text-pa-muted">文本</span>}
      interacting={interacting}
      affordance={editing ? "pinned" : "hover"}
      frame="xl"
      actions={
        editing && onRemove ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label="瓦片操作"
                  size="icon-xs"
                  variant="subtle"
                  className={tileEditMenuTriggerClass}
                />
              }
            >
              <EllipsisIcon aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem disabled={!canMoveUp} onClick={onMoveUp}>
                <ArrowUpIcon aria-hidden="true" />
                上移
              </MenuItem>
              <MenuItem disabled={!canMoveDown} onClick={onMoveDown}>
                <ArrowDownIcon aria-hidden="true" />
                下移
              </MenuItem>
              <MenuDangerGroup>
                <MenuItem onClick={onRemove}>
                  <Trash2Icon aria-hidden="true" />
                  删除
                </MenuItem>
              </MenuDangerGroup>
            </MenuPopup>
          </Menu>
        ) : undefined
      }
    >
      <div className="min-h-0 flex-1 overflow-auto">
        {editing ? (
          <Textarea
            aria-label="文本内容"
            data-dontdrag
            value={md}
            onChange={(e) => onChangeMd(e.target.value)}
            placeholder="写点说明（支持 Markdown：标题、列表、加粗、链接、表格）"
            className="min-h-16 resize-none"
          />
        ) : (
          <TextMarkdown md={md} />
        )}
      </div>
    </TileShell>
  );
}

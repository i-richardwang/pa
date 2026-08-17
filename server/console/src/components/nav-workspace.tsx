"use client";

import { ChevronDownIcon, LogOutIcon, SettingsIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuPopup, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";

function initials(email: string): string {
  return email.slice(0, 1).toUpperCase();
}

/**
 * 工作区菜单：栏头触发器 + 徽标，弹出面随内容撑开、不定死宽度。
 */
export function NavWorkspace({
  user,
  onOpenSettings,
  onSignOut,
}: {
  user: { name: string; email: string };
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger className="flex w-min max-w-full cursor-pointer items-center rounded-xl p-1.5 text-left outline-none hover:bg-pa-surface focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring data-popup-open:bg-pa-surface md:rounded-lg">
        <span className="flex min-w-0 items-center gap-2">
          <Avatar shape="square" size="xs" tone="accent">
            {initials(user.email)}
          </Avatar>
          <span className="truncate pb-px font-normal text-sm text-pa-fg">{user.name}</span>
        </span>
        <ChevronDownIcon className="ml-1 size-3 shrink-0 text-pa-faint" strokeWidth={2} />
      </MenuTrigger>
      <MenuPopup
        align="start"
        className="min-w-[240px]"
        side="bottom"
        sideOffset={6}
        viewportClassName="p-1.5"
      >
        <div className="mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2">
          <Avatar shape="square" size="xs" tone="accent">
            {initials(user.email)}
          </Avatar>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate font-medium text-sm text-pa-fg">{user.name}</div>
            <div className="truncate text-2xs text-pa-fg-soft">{user.email}</div>
          </div>
        </div>
        <MenuSeparator className="mx-1.5 bg-pa-line-subtle" />
        <MenuItem onClick={onOpenSettings}>
          <SettingsIcon />
          设置
        </MenuItem>
        <MenuItem onClick={onSignOut}>
          <LogOutIcon />
          退出登录
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

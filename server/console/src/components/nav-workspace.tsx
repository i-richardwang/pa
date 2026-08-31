import { ChevronDownIcon, LogOutIcon, SettingsIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { PopupSection } from "@/components/ui/surface";

function initials(email: string): string {
  return email.slice(0, 1).toUpperCase();
}

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
      <MenuTrigger className="pa-focus flex w-min max-w-full cursor-pointer items-center rounded-xl p-1.5 text-left hover:bg-pa-surface data-popup-open:bg-pa-surface md:rounded-lg">
        <span className="flex min-w-0 items-center gap-2">
          <Avatar shape="square" size="xs" tone="accent">
            {initials(user.email)}
          </Avatar>
          <span className="truncate pb-px font-normal text-sm text-pa-fg">{user.name}</span>
        </span>
        <ChevronDownIcon className="ml-1 size-3 shrink-0 text-pa-faint" strokeWidth={2} />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom" sideOffset={6} width="list">
        <div className="mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2">
          <Avatar shape="square" size="xs" tone="accent">
            {initials(user.email)}
          </Avatar>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate font-medium text-sm text-pa-fg">{user.name}</div>
            <div className="truncate text-2xs text-pa-fg-soft">{user.email}</div>
          </div>
        </div>
        <PopupSection>
          <MenuItem onClick={onOpenSettings}>
            <SettingsIcon />
            设置
          </MenuItem>
          <MenuItem onClick={onSignOut}>
            <LogOutIcon />
            退出登录
          </MenuItem>
        </PopupSection>
      </MenuPopup>
    </Menu>
  );
}

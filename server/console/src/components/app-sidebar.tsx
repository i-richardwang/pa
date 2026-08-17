"use client";

import type { MePayload } from "@contract";
import { NavMain, type NavMainGroup } from "@/components/nav-main";
import { NavWorkspace } from "@/components/nav-workspace";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarSearchButton,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { RouteKey } from "@/dashboard/router";

/**
 * 侧栏装配：栏头工作区下拉 + 收起（hover 显）+ 搜索；栏中扁平导航；无栏底账号脚。
 * 工具钮与导航条是两套配方，禁止混用 SidebarMenuButton。
 */
export function AppSidebar({
  groups,
  route,
  me,
  onNavigate,
  onOpenSearch,
  onOpenSettings,
  onSignOut,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  groups: readonly NavMainGroup[];
  route: RouteKey;
  me: MePayload;
  onNavigate: (key: RouteKey) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const name = me.email.split("@")[0] ?? me.email;

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-0.5">
          <div className="min-w-0 flex-1">
            <NavWorkspace
              onOpenSettings={onOpenSettings}
              onSignOut={onSignOut}
              user={{ name, email: me.email }}
            />
          </div>
          <div className="flex shrink-0 items-center">
            <div
              className={cn(
                "transition-opacity duration-150",
                "opacity-100 md:opacity-0",
                "md:group-hover/sidebar-inner:opacity-100",
                "has-[:focus-visible]:opacity-100",
              )}
            >
              <SidebarTrigger className="text-pa-muted" title="收起侧栏" />
            </div>
            <SidebarSearchButton onClick={onOpenSearch} />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={groups} onNavigate={onNavigate} route={route} />
      </SidebarContent>
    </Sidebar>
  );
}

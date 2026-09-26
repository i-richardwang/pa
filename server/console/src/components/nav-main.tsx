import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { RouteKey } from "@/dashboard/router";

export type NavMainItem = {
  key: RouteKey;
  title: string;
  icon: React.ReactNode;
};

export type NavMainGroup = {
  label: string;
  items: readonly NavMainItem[];
};

/** 图标包在单独的方框里，选中背景与图标边缘之间留出空隙。 */
export function NavMain({
  groups,
  route,
  onNavigate,
}: {
  groups: readonly NavMainGroup[];
  route: RouteKey;
  onNavigate: (key: RouteKey) => void;
}) {
  return (
    <>
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <SidebarGroup key={group.label || "primary"}>
            {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    isActive={item.key === route}
                    onClick={() => onNavigate(item.key)}
                  >
                    <span className="mr-0.5 flex size-8 shrink-0 items-center justify-center [&_svg]:size-4">
                      {item.icon}
                    </span>
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ),
      )}
    </>
  );
}

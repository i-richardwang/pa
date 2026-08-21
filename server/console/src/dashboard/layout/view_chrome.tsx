import type * as React from "react";
import { CircleAlertIcon, EllipsisIcon, PanelRightIcon } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Menu, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { InspectorBody } from "@/components/ui/inspector";
import { Titlebar } from "@/components/ui/titlebar";
import { LoadingMark } from "pa-result-view";
import { cn } from "@/lib/utils";

export function HeaderIconButton({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className={cn("[&_svg]:size-4", className)}
            size="icon"
            variant="subtle"
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * 题条上的「更多」：与表行末那枚 `RowMenu` 同一套菜单、不同一档钮——题条属于壳，
 * 行末属于内容。借用行末那枚，同一条题条上就会并排出现两种图标钮长相。
 */
export function HeaderMenu({
  label = "更多操作",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Menu>
      <MenuTrigger render={<HeaderIconButton label={label} />}>
        <EllipsisIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">{children}</MenuPopup>
    </Menu>
  );
}

export function HeaderTextAction({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "variant" | "size">): React.ReactElement {
  return <Button variant="subtle" className={cn("[&_svg]:size-4", className)} {...props} />;
}

/**
 * 查看面首载：住在结果区内，等待期间那片地方空着，正中一枚加载标记。
 * 题名与底栏都在结果区之外，首载时它们已经就位，本件只管绘图区那一格。
 */
export function ViewPageLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LoadingMark />
    </div>
  );
}

export function ViewPageError({ message }: { message: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center p-4">
      <Alert variant="error">
        <CircleAlertIcon />
        <AlertTitle>{message}</AlertTitle>
      </Alert>
    </div>
  );
}

/** 档案栏的壳：通高一条栏，栏顶只有一枚关闭钮，栏身是档案密度的可滚正文。 */
export function ProfileAside({
  label,
  closeLabel,
  onClose,
  children,
}: {
  /** 这条栏是谁的档案，念给读屏听。 */
  label: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className="relative flex h-full min-h-0 w-full min-w-0 flex-col bg-pa-bg"
      data-slot="profile-aside"
    >
      <Titlebar align="end" className="gap-0">
        <HeaderIconButton label={closeLabel} onClick={onClose}>
          <PanelRightIcon aria-hidden="true" />
        </HeaderIconButton>
      </Titlebar>
      <InspectorBody density="reading">{children}</InspectorBody>
    </aside>
  );
}

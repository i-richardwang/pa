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

export function ProfileAside({
  label,
  closeLabel,
  onClose,
  children,
}: {
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
      <InspectorBody face="profile">{children}</InspectorBody>
    </aside>
  );
}

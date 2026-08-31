import { Toast } from "@base-ui/react/toast";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TOAST_ICONS = {
  error: CircleAlertIcon,
  info: InfoIcon,
  loading: LoaderCircleIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
} as const;

function upsertReplayClassName(toast: { type?: string; updateKey?: number }): string | undefined {
  const k = toast.updateKey ?? 0;
  if (k <= 0) return undefined;
  const isEven = k % 2 === 0;
  if (toast.type === "error") {
    return isEven ? "animate-toast-error-even" : "animate-toast-error-odd";
  }
  return isEven ? "animate-toast-success-even" : "animate-toast-success-odd";
}

function Toasts(): React.ReactElement {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Portal data-slot="toast-portal">
      <Toast.Viewport
        className="fixed bottom-(--toast-inset) left-1/2 z-60 flex w-[calc(100%-var(--toast-inset)*2)] max-w-150 -translate-x-1/2 justify-center [--toast-inset:--spacing(4)] sm:[--toast-inset:--spacing(6)]"
        data-slot="toast-viewport"
      >
        {toasts.map((toast) => {
          const Icon = toast.type ? TOAST_ICONS[toast.type as keyof typeof TOAST_ICONS] : null;

          return (
            <Toast.Root
              key={toast.id}
              className={cn(
                "absolute right-0 bottom-0 left-0 flex h-(--toast-calc-height) min-h-10 select-none justify-center",
                "z-[calc(9999-var(--toast-index))] [transition:transform_.5s_cubic-bezier(.22,1,.36,1),opacity_.5s,height_.15s]",
                "origin-[50%_calc(50%+50%*min(var(--toast-index,0),1))]",
                "after:absolute after:bottom-full after:left-0 after:h-[calc(var(--toast-gap)+1px)] after:w-full",
                "[--toast-calc-height:var(--toast-frontmost-height,var(--toast-height))] [--toast-gap:--spacing(3)] [--toast-peek:--spacing(3)] [--toast-scale:calc(max(0,1-(var(--toast-index)*.1)))] [--toast-shrink:calc(1-var(--toast-scale))]",
                "[--toast-calc-offset-y:calc(var(--toast-offset-y)*-1+var(--toast-index)*var(--toast-gap)*-1+var(--toast-swipe-movement-y))]",
                "transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--toast-peek))-(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))]",
                "data-limited:opacity-0",
                "data-expanded:h-(--toast-height)",
                "data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--toast-calc-offset-y))]",
                "data-starting-style:transform-[translateY(calc(100%+var(--toast-inset)))]",
                "data-ending-style:opacity-0",
                "data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateY(calc(100%+var(--toast-inset)))]",
                "data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]",
                "data-expanded:data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]",
                upsertReplayClassName(toast),
              )}
              swipeDirection="down"
              toast={toast}
            >
              <Toast.Content
                className="group/toast pointer-events-auto flex h-full max-w-full items-center gap-4 overflow-hidden rounded-lg bg-[color-mix(in_srgb,var(--pa-tooltip-bg),var(--pa-page)_calc(5%*max(0,var(--toast-index,0))))] py-1.5 pr-2 pl-4 text-md text-pa-fg [color-scheme:dark] data-behind:not-data-expanded:pointer-events-none data-expanded:bg-(--pa-tooltip-bg)"
                data-slot="toast-content"
              >
                <div className="flex min-w-0 gap-2 transition-opacity duration-250 group-data-behind/toast:opacity-0 group-data-expanded/toast:opacity-100">
                  {Icon && (
                    <div
                      className="[&>svg]:h-lh [&>svg]:w-4 [&_svg]:pointer-events-none [&_svg]:shrink-0"
                      data-slot="toast-icon"
                    >
                      <Icon className="in-data-[type=loading]:animate-spin in-data-[type=error]:text-pa-danger-fg in-data-[type=info]:text-pa-info-fg in-data-[type=success]:text-pa-success-fg in-data-[type=warning]:text-pa-warning-fg in-data-[type=loading]:opacity-80" />
                    </div>
                  )}
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Toast.Title className="font-medium" data-slot="toast-title" />
                    <Toast.Description
                      className="text-pa-muted text-xs"
                      data-slot="toast-description"
                    />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 transition-opacity duration-250 group-data-behind/toast:opacity-0 group-data-expanded/toast:opacity-100">
                  {toast.actionProps && (
                    <Toast.Action
                      className="pa-focus h-7 rounded-md bg-pa-surface px-3 font-medium text-pa-fg hover:bg-pa-selected"
                      data-slot="toast-action"
                    >
                      {toast.actionProps.children}
                    </Toast.Action>
                  )}
                  <Toast.Close
                    aria-label="关闭"
                    data-slot="toast-close"
                    render={
                      <Button
                        className="shrink-0 text-pa-muted hover:text-pa-fg"
                        size="icon-sm"
                        variant="subtle"
                      />
                    }
                  >
                    <XIcon className="size-4" />
                  </Toast.Close>
                </div>
              </Toast.Content>
            </Toast.Root>
          );
        })}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export const toastManager: ReturnType<typeof Toast.createToastManager> = Toast.createToastManager();

export function ToastProvider({ children, ...props }: Toast.Provider.Props): React.ReactElement {
  return (
    <Toast.Provider toastManager={toastManager} {...props}>
      {children}
      <Toasts />
    </Toast.Provider>
  );
}

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type React from "react";
import { cn } from "@/lib/utils";

export type TableProps = React.ComponentProps<"table"> & {
  render?: useRender.ComponentProps<"div">["render"];
};

export function Table({ className, render, ...props }: TableProps): React.ReactElement {
  const defaultProps = {
    children: (
      <table
        className={cn("w-full table-auto caption-bottom text-sm", className)}
        data-slot="table"
        {...props}
      />
    ),
    className: "w-full overflow-x-auto",
    "data-slot": "table-container",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, {}),
    render,
  });
}

export function TableHeader({
  className,
  ...props
}: React.ComponentProps<"thead">): React.ReactElement {
  return (
    <thead
      className={cn("[&_tr]:border-t-0 [&_tr]:hover:bg-transparent", className)}
      data-slot="table-header"
      {...props}
    />
  );
}

export function TableBody({
  className,
  ...props
}: React.ComponentProps<"tbody">): React.ReactElement {
  return <tbody className={cn(className)} data-slot="table-body" {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">): React.ReactElement {
  return (
    <tr
      className={cn("group/row relative border-t border-pa-line hover:bg-pa-wash", className)}
      data-slot="table-row"
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<"th">): React.ReactElement {
  return (
    <th
      className={cn(
        "whitespace-nowrap p-2 text-left align-middle font-normal text-sm text-pa-faint has-[[role=checkbox]]:w-px last:has-[[role=checkbox]]:ps-0 first:has-[[role=checkbox]]:pe-0",
        className,
      )}
      data-slot="table-head"
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<"td">): React.ReactElement {
  return (
    <td
      className={cn(
        "whitespace-nowrap px-2 py-3 align-middle text-sm has-[[role=checkbox]]:w-px last:has-[[role=checkbox]]:ps-0 first:has-[[role=checkbox]]:pe-0",
        className,
      )}
      data-slot="table-cell"
      {...props}
    />
  );
}

import { Sheet, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { SheetSection } from "../kit/sheet_kit";

function cellText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function RecordRowSheet({
  open,
  onOpenChange,
  title,
  columns,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  columns: string[];
  row: (string | number | null)[] | null;
}) {
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <SheetPanel>
          <SheetSection title="字段">
            <dl className="space-y-2 text-sm">
              {columns.map((column, index) => (
                <div key={`${column}:${index}`}>
                  <dt className="text-pa-muted text-xs">{column}</dt>
                  <dd className="font-medium">{cellText(row?.[index])}</dd>
                </div>
              ))}
            </dl>
          </SheetSection>
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}

import { CheckIcon, CopyIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyToClipboard } from "@/hooks/use_copy_text";
import { HeaderTextAction } from "../layout/view_chrome";

export function CodeCopyButton({
  code,
  label,
  hint,
}: {
  code: string;
  label: string;
  hint: string;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <HeaderTextAction aria-label={`复制${label}`} onClick={() => copyToClipboard(code)} />
        }
      >
        {isCopied ? (
          <>
            <CheckIcon aria-hidden="true" />
            已复制
          </>
        ) : (
          <>
            <CopyIcon aria-hidden="true" />
            复制{label}
          </>
        )}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{hint}</p>
      </TooltipPopup>
    </Tooltip>
  );
}

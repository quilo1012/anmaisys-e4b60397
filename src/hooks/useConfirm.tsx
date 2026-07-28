import { useCallback, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type ConfirmOpts = {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

/**
 * Promise-based confirm using the themed AlertDialog instead of the native,
 * unstyled window.confirm(). Usage:
 *   const { confirm, confirmDialog } = useConfirm();
 *   ... if (await confirm({ title, destructive: true })) doThing();
 *   ... render {confirmDialog} once in the component.
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmOpts & { open: boolean }>({ open: false });
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOpts = {}) => {
    setState({ ...opts, open: true });
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const settle = (v: boolean) => {
    setState((s) => ({ ...s, open: false }));
    resolver.current?.(v);
    resolver.current = null;
  };

  const confirmDialog = (
    <AlertDialog open={state.open} onOpenChange={(o) => { if (!o) settle(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state.title ?? "Are you sure?"}</AlertDialogTitle>
          {state.description && <AlertDialogDescription>{state.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>{state.cancelText ?? "Cancel"}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            className={cn(state.destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
          >
            {state.confirmText ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, confirmDialog };
}

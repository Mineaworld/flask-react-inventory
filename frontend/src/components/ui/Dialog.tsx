import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

import { X } from "lucide-react";

import { Button } from "./Button";

type DialogProps = {
  children: ReactNode;
  description?: string;
  onClose: () => void;
  open: boolean;
  title: string;
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type BackgroundIsolationState = {
  appRoot: HTMLElement | null;
  ariaHidden: string | null;
  inert: boolean;
  inertAttribute: string | null;
  overflow: string;
};

type ActiveDialog = {
  id: symbol;
  getElement: () => HTMLElement | null;
};

let activeDialogs: ActiveDialog[] = [];
let backgroundIsolation: BackgroundIsolationState | null = null;

const focusDialog = (dialog: HTMLElement | null) => {
  const initialFocus = dialog?.querySelector<HTMLElement>("[data-dialog-initial-focus]")
    ?? dialog?.querySelector<HTMLElement>(focusableSelector)
    ?? dialog;
  initialFocus?.focus();
};

const activateBackgroundIsolation = (dialog: ActiveDialog) => {
  if (activeDialogs.length === 0) {
    const appRoot = document.getElementById("root");
    backgroundIsolation = {
      appRoot,
      ariaHidden: appRoot?.getAttribute("aria-hidden") ?? null,
      inert: appRoot?.inert ?? false,
      inertAttribute: appRoot?.getAttribute("inert") ?? null,
      overflow: document.body.style.overflow,
    };
    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute("inert", "");
      appRoot.setAttribute("aria-hidden", "true");
    }
    document.body.style.overflow = "hidden";
  }
  activeDialogs.push(dialog);
};

const isTopDialog = (id: symbol) => activeDialogs.at(-1)?.id === id;

const deactivateBackgroundIsolation = (id: symbol) => {
  activeDialogs = activeDialogs.filter((dialog) => dialog.id !== id);
  const nextDialog = activeDialogs.at(-1)?.getElement() ?? null;
  if (nextDialog) {
    if (!nextDialog.contains(document.activeElement)) {
      focusDialog(nextDialog);
    }
    return false;
  }

  const state = backgroundIsolation;
  backgroundIsolation = null;
  if (state) {
    document.body.style.overflow = state.overflow;
    if (state.appRoot) {
      state.appRoot.inert = state.inert;
      if (state.inertAttribute === null) {
        state.appRoot.removeAttribute("inert");
      } else {
        state.appRoot.setAttribute("inert", state.inertAttribute);
      }
      if (state.ariaHidden === null) {
        state.appRoot.removeAttribute("aria-hidden");
      } else {
        state.appRoot.setAttribute("aria-hidden", state.ariaHidden);
      }
    }
  }
  return true;
};

export const Dialog = ({ children, description, onClose, open, title }: DialogProps) => {
  const dialogRef = useRef<HTMLElement>(null);
  const dialogIdRef = useRef(Symbol("dialog"));
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activateBackgroundIsolation({ id: dialogIdRef.current, getElement: () => dialogRef.current });
    focusDialog(dialogRef.current);

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && isTopDialog(dialogIdRef.current)) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (deactivateBackgroundIsolation(dialogIdRef.current)) {
        previousFocusRef.current?.focus();
      }
    };
  }, [open]);

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;
    if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--overlay)] p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-[var(--surface)] p-5 shadow-[var(--shadow-elevated)] sm:p-6"
        role="dialog"
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="font-display text-xl font-semibold leading-tight tracking-[-0.03em] text-[var(--ink)]">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 max-w-md text-pretty text-sm text-[var(--muted)]">{description}</p> : null}
          </div>
          <Button aria-label="Close dialog" variant="quiet" size="icon" onClick={onClose}><X size={18} /></Button>
        </div>
        <div className="mt-5">{children}</div>
      </section>
    </div>,
    document.body,
  );
};

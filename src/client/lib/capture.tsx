import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

interface CaptureContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The unsaved note, kept when the sheet closes so nothing is lost. */
  draft: string;
  setDraft: (draft: string) => void;
}

const CaptureContext = createContext<CaptureContextValue | null>(null);

/** Holds the capture sheet's state, so any screen can open it. */
export function CaptureProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const value = useMemo(() => ({ open, setOpen, draft, setDraft }), [open, draft]);
  return <CaptureContext value={value}>{children}</CaptureContext>;
}

export function useCapture(): CaptureContextValue {
  const value = useContext(CaptureContext);
  if (!value) throw new Error("useCapture must be used inside <CaptureProvider>");
  return value;
}

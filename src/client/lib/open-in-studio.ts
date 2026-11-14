import { fileUrl } from "@shared/api";
import { bambuStudioUrl, type OpenLinkResponse, type OpenPart, openTarget } from "@shared/open-link";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useIsDesktop } from "./use-media-query";

/** Bambu Studio runs on a Mac, a PC or Linux: not on a phone or a tablet (an iPad says it is a Mac, but has touch). */
export function runsBambuStudio(): boolean {
  if (typeof navigator === "undefined") return false;
  const touch = navigator.maxTouchPoints > 1;
  return !/Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent) && !touch;
}

const isMac = () => /Mac/i.test(navigator.platform || navigator.userAgent);

/** Whether to offer "Open in Bambu Studio" here: a computer's layout on a computer. */
export function useCanOpenInStudio(): boolean {
  return useIsDesktop() && runsBambuStudio();
}

/** How long "Nothing opened? Download it instead" stays after a tap. */
export const TRIED_MS = 12_000;

export type StudioState =
  | { phase: "ready" }
  | { phase: "asking" }
  | { phase: "tried"; download: string; name: string }
  | { phase: "failed" };

/**
 * Opening one kept file in Bambu Studio: asks the Worker for a signed link, and sends the browser to the address that
 * makes Bambu Studio fetch it. A browser can't tell whether an app opened, so afterwards it says where the plain
 * download is, for a few seconds.
 */
export function useOpenInStudio(file: Parameters<typeof openTarget>[0] & { id: string }) {
  const target = openTarget(file);
  const [state, setState] = useState<StudioState>({ phase: "ready" });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const open = async () => {
    if (!target || state.phase === "asking") return;
    setState({ phase: "asking" });
    try {
      const made = await api<OpenLinkResponse>(`/files/${file.id}/open-link`, {
        method: "POST",
        json: { part: target.part },
      });
      // A click on a real link: how a browser hands a custom address to the app that has it.
      const link = document.createElement("a");
      link.href = bambuStudioUrl(made.url, isMac());
      link.rel = "noreferrer";
      document.body.append(link);
      link.click();
      link.remove();
      setState({ phase: "tried", download: fileUrl(file.id, target.part as OpenPart), name: made.name });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState({ phase: "ready" }), TRIED_MS);
    } catch {
      setState({ phase: "failed" });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState({ phase: "ready" }), TRIED_MS);
    }
  };
  return { target, state, open };
}

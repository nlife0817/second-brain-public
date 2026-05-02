"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTimingStore } from "@/lib/timing-store";

/**
 * Document Picture-in-Picture: open a system-level always-on-top mini window
 * containing a React subtree. Returns refs/handlers for a portal target and
 * the open/close API.
 *
 * Spec: https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API
 * Supported in Chromium 116+ (Chrome / Edge / Brave / Arc / Opera).
 */
export interface PiPApi {
  supported: boolean;
  open: boolean;
  /** Document body of the PiP window — pass to createPortal once open. */
  containerNode: HTMLElement | null;
  requestOpen: () => Promise<void>;
  close: () => void;
}

interface DocumentPiPGlobal {
  documentPictureInPicture?: {
    requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>;
    window: Window | null;
  };
}

function getApi(): DocumentPiPGlobal["documentPictureInPicture"] | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as DocumentPiPGlobal;
  return w.documentPictureInPicture ?? null;
}

/**
 * Copy all <style> and <link rel="stylesheet"> nodes from the main document
 * into the PiP window so React-rendered content matches the app theme.
 *
 * Important: linked stylesheets need to be cloned (deep clone) — referencing
 * the same Node from another Document throws. <style> contents we copy by
 * inserting fresh <style> nodes with the same text.
 */
function mirrorStyles(target: Document) {
  // <style> blocks
  for (const styleEl of Array.from(document.querySelectorAll("style"))) {
    const clone = target.createElement("style");
    clone.textContent = styleEl.textContent;
    target.head.appendChild(clone);
  }
  // <link rel="stylesheet">
  for (const linkEl of Array.from(
    document.querySelectorAll('link[rel="stylesheet"]'),
  )) {
    const link = target.createElement("link");
    link.rel = "stylesheet";
    const href = (linkEl as HTMLLinkElement).href;
    if (href) link.href = href;
    target.head.appendChild(link);
  }
  // Copy <html> class (theme dark/light)
  target.documentElement.className = document.documentElement.className;
  target.body.style.margin = "0";
  target.body.style.background = "transparent";
}

export function usePipTimer(): PiPApi {
  const [supported] = useState(() => Boolean(getApi()));
  const [containerNode, setContainerNode] = useState<HTMLElement | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const setPipOpen = useTimingStore((s) => s.setPipOpen);
  const touchActive = useTimingStore((s) => s.touchActive);

  const close = useCallback(() => {
    pipWindowRef.current?.close();
  }, []);

  const requestOpen = useCallback(async () => {
    const api = getApi();
    if (!api) return;
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.focus();
      return;
    }
    let pipWin: Window;
    try {
      pipWin = await api.requestWindow({ width: 280, height: 140 });
    } catch (e) {
      console.error("[timing pip] requestWindow failed", e);
      return;
    }
    pipWindowRef.current = pipWin;

    // Mark this window so TimingProvider doesn't double-mount.
    (pipWin as unknown as { __sb_isPip?: boolean }).__sb_isPip = true;

    mirrorStyles(pipWin.document);
    pipWin.document.title = "Таймер";

    // Create a stable container for the React portal.
    const container = pipWin.document.createElement("div");
    container.id = "pip-root";
    container.style.height = "100vh";
    container.style.width = "100vw";
    pipWin.document.body.appendChild(container);

    // Register activity inside PiP as user activity in the main store —
    // prevents the idle watcher from firing while you're using the PiP.
    const activityEvents: (keyof DocumentEventMap)[] = [
      "mousemove",
      "keydown",
      "click",
      "touchstart",
    ];
    let lastTouch = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastTouch < 5000) return;
      lastTouch = now;
      touchActive();
    };
    for (const e of activityEvents) {
      pipWin.document.addEventListener(e, onActivity, { passive: true });
    }

    const onPageHide = () => {
      pipWindowRef.current = null;
      setContainerNode(null);
      setPipOpen(false);
    };
    pipWin.addEventListener("pagehide", onPageHide);

    setContainerNode(container);
    setPipOpen(true);
  }, [setPipOpen, touchActive]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      pipWindowRef.current?.close();
    };
  }, []);

  return {
    supported,
    open: containerNode !== null,
    containerNode,
    requestOpen,
    close,
  };
}

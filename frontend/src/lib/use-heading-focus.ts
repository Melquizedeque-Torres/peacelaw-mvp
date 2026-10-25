import { useEffect, useRef } from "react";

// Moves keyboard/screen-reader focus to a view's main heading (tabIndex -1) whenever
// `key` changes, so view or step changes are announced instead of dropping focus on <body>.
export function useHeadingFocus<T extends HTMLElement>(active: boolean, key?: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active, key]);
  return ref;
}

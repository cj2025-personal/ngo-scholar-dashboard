"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MOMENT_MS, normalisePose } from "@/lib/kivyn/pose.mjs";

/**
 * A finished piece of work, shown for a moment: `show("done")` when an
 * outline or a proposal lands, `show("cant-answer")` when the paper did not
 * carry what was asked. The moment ends by itself and Kivyn is at rest; a
 * new one replaces the last, and work starting clears it.
 *
 * @returns {[string|null, (pose: string|null) => void]}
 */
export function useKivynMoment(ms = MOMENT_MS) {
  const [moment, setMoment] = useState(null);
  const timer = useRef(null);
  const show = useCallback((pose) => {
    clearTimeout(timer.current);
    if (!pose) { setMoment(null); return; }
    setMoment(normalisePose(pose));
    timer.current = setTimeout(() => setMoment(null), ms);
  }, [ms]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [moment, show];
}

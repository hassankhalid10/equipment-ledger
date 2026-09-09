"use client";

import { useState } from "react";

/**
 * One key per opened dialog, reused for every retry of that same submit.
 *
 * That is the point: if the request times out and the keeper clicks again,
 * the second request carries the same key and the server returns the
 * original result instead of writing a second movement (FR-19). A new key
 * is minted only when the dialog is opened afresh, which is a genuinely
 * new intent.
 *
 * Written as a render-phase adjustment rather than an effect. The dialogs
 * stay mounted while closed, so the key has to change when `open` flips -
 * and doing that in useEffect would setState during an effect, causing the
 * cascading re-render React warns about.
 */
export function useIdempotencyKey(open: boolean): string {
  const [state, setState] = useState(() => ({ open, key: crypto.randomUUID() }));

  if (open !== state.open) {
    setState({ open, key: open ? crypto.randomUUID() : state.key });
  }

  return state.key;
}

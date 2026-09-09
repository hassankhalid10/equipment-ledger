"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, ApiError } from "@/lib/api";
import { writeAffectedKeys } from "@/lib/keys";
import type { WriteResponse } from "@/lib/types";

/**
 * Every write goes through here, which is where the two rules the spec's
 * attack list probes are enforced in one place rather than per-dialog:
 *
 *  - No optimistic update. `onMutate` is not used anywhere in this app. The
 *    UI shows pending, then either the server's confirmed truth or an
 *    explicit error. It never claims a movement happened.
 *  - No silent retry. The idempotency key makes a retry safe, but a hidden
 *    one would hide exactly the mid-request failure the assessor provokes,
 *    so `retry: false` is set on mutations globally (see providers.tsx) and
 *    the keeper sees what went wrong.
 *
 * The idempotency key is generated once by the dialog when it opens and
 * passed in here, so every retry of that same submit reuses it - a timeout
 * followed by a second click cannot create a second movement.
 */
export function useWrite(options: { successMessage: (result: WriteResponse) => string }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      path,
      body,
      idempotencyKey,
    }: {
      path: string;
      body: Record<string, unknown>;
      idempotencyKey: string;
    }) =>
      api<WriteResponse>(path, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body),
      }),

    onSuccess: async (result) => {
      // Re-read from the server rather than patching anything locally.
      await Promise.all(
        writeAffectedKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
      );
      toast.success(options.successMessage(result));
    },

    onError: (error) => {
      // The API's own sentence, verbatim. The frontend never invents wording
      // for a business refusal - a keeper reads this aloud.
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    },
  });
}

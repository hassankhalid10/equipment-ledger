"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, Field, SubmitRow, inputClass } from "@/components/Dialog";
import { ErrorBanner } from "@/components/ErrorBanner";
import { KeeperRequired } from "@/components/KeeperPicker";
import { useIdempotencyKey } from "./useIdempotencyKey";
import { useWrite } from "@/hooks/useWrite";
import { useKeeperStore } from "@/stores/keeper";
import { fromLocalInputValue } from "@/lib/dates";
import type { AssetView } from "@/lib/types";

const schema = z.object({
  text: z.string().min(1, "Say why."),
  occurredAt: z.string().optional(),
});

type Values = z.infer<typeof schema>;

/** One dialog for both directions - they are the same shape, and a keeper
 * only ever sees whichever one applies to the asset's current state. */
export function ServiceDialog({
  asset,
  open,
  onClose,
}: {
  asset: AssetView;
  open: boolean;
  onClose: () => void;
}) {
  const { keeperId } = useKeeperStore();
  const idempotencyKey = useIdempotencyKey(open);
  const takingOut = asset.serviceable;

  const write = useWrite({
    successMessage: (r) =>
      takingOut
        ? `${asset.code} is out of service.` +
          (r.cancelledReservations ? ` ${r.cancelledReservations} reservation(s) cancelled.` : "")
        : `${asset.code} is back in service.`,
  });

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { text: "" } });

  const onSubmit = (values: Values) => {
    if (!keeperId) return;
    write.mutate(
      {
        path: `/assets/${asset.id}/${takingOut ? "out-of-service" : "back-in-service"}`,
        idempotencyKey,
        body: {
          keeperId,
          ...(takingOut ? { reason: values.text } : { note: values.text }),
          ...(values.occurredAt ? { occurredAt: fromLocalInputValue(values.occurredAt) } : {}),
        },
      },
      { onSuccess: () => { form.reset(); onClose(); } },
    );
  };

  return (
    <Dialog
      open={open}
      title={takingOut ? `Take ${asset.code} out of service` : `Bring ${asset.code} back`}
      onClose={onClose}
    >
      {!keeperId ? (
        <KeeperRequired />
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          {takingOut && (
            <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-700">
              Standing future reservations are cancelled with this reason recorded. The current
              holder is <span className="font-medium">not</span> forced to hand it back — it is
              simply unserviceable from this instant.
            </p>
          )}

          <Field
            label={takingOut ? "Reason" : "Note"}
            error={form.formState.errors.text?.message}
          >
            <input type="text" className={inputClass} {...form.register("text")} />
          </Field>

          <Field label="When it happened" hint="Leave blank for now.">
            <input type="datetime-local" className={inputClass} {...form.register("occurredAt")} />
          </Field>

          {write.error && <ErrorBanner error={write.error} />}

          <SubmitRow
            pending={write.isPending}
            submitLabel={takingOut ? "Take out of service" : "Back in service"}
            onCancel={onClose}
          />
        </form>
      )}
    </Dialog>
  );
}

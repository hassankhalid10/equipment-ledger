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
import { formatDateTime } from "@/lib/dates";
import type { ReservationView } from "@/lib/types";

const schema = z.object({
  reason: z.string().min(1, "Say why it is being cancelled."),
});

type Values = z.infer<typeof schema>;

/**
 * Cancelling records a reason and leaves the reservation visible with its
 * CANCELLED status - it is never deleted, same principle as corrections.
 * Only a PENDING reservation can be cancelled; the server refuses one that
 * was already collected or cancelled.
 */
export function CancelReservationDialog({
  reservation,
  open,
  onClose,
}: {
  reservation: ReservationView;
  open: boolean;
  onClose: () => void;
}) {
  const { keeperId } = useKeeperStore();
  const idempotencyKey = useIdempotencyKey(open);
  const write = useWrite({ successMessage: () => "Reservation cancelled, with the reason recorded." });

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { reason: "" } });

  const onSubmit = (values: Values) => {
    if (!keeperId) return;
    write.mutate(
      {
        path: `/reservations/${reservation.id}/cancel`,
        idempotencyKey,
        body: { keeperId, reason: values.reason },
      },
      { onSuccess: () => { form.reset(); onClose(); } },
    );
  };

  return (
    <Dialog open={open} title="Cancel this reservation" onClose={onClose}>
      {!keeperId ? (
        <KeeperRequired />
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-700">
            {reservation.worker?.name ?? "Someone"},{" "}
            <span title={`${reservation.startsAt} → ${reservation.endsAt}`}>
              {formatDateTime(reservation.startsAt)} → {formatDateTime(reservation.endsAt)}
            </span>
            . The reservation stays on the record as cancelled, with this reason attached.
          </p>

          <Field label="Reason" error={form.formState.errors.reason?.message}>
            <input type="text" className={inputClass} {...form.register("reason")} />
          </Field>

          {write.error && <ErrorBanner error={write.error} />}

          <SubmitRow pending={write.isPending} submitLabel="Cancel reservation" onCancel={onClose} />
        </form>
      )}
    </Dialog>
  );
}

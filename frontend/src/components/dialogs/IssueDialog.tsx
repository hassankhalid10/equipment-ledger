"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, Field, SubmitRow, inputClass } from "@/components/Dialog";
import { ErrorBanner } from "@/components/ErrorBanner";
import { KeeperRequired } from "@/components/KeeperPicker";
import { useIdempotencyKey } from "./useIdempotencyKey";
import { useWorkers } from "@/hooks/queries";
import { useWrite } from "@/hooks/useWrite";
import { useKeeperStore } from "@/stores/keeper";
import { fromLocalInputValue } from "@/lib/dates";
import type { AssetView } from "@/lib/types";

/** Client-side shape only. The server re-checks everything and is the
 * authority; this is here so a keeper gets an answer without a round trip. */
const schema = z.object({
  workerId: z.string().min(1, "Pick who is taking it."),
  occurredAt: z.string().optional(),
  dueAt: z.string().optional(),
  note: z.string().max(1000).optional(),
});

type Values = z.infer<typeof schema>;

export function IssueDialog({
  asset,
  open,
  onClose,
}: {
  asset: AssetView;
  open: boolean;
  onClose: () => void;
}) {
  const { keeperId } = useKeeperStore();
  const { data: workers } = useWorkers();
  const idempotencyKey = useIdempotencyKey(open);
  const write = useWrite({
    successMessage: (r) => `${asset.code} issued to ${r.movement?.worker?.name ?? "worker"}.`,
  });

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { workerId: "" } });

  const onSubmit = (values: Values) => {
    if (!keeperId) return;
    write.mutate(
      {
        path: "/movements/issue",
        idempotencyKey,
        body: {
          assetId: asset.id,
          workerId: values.workerId,
          keeperId,
          ...(values.occurredAt ? { occurredAt: fromLocalInputValue(values.occurredAt) } : {}),
          ...(values.dueAt ? { dueAt: fromLocalInputValue(values.dueAt) } : {}),
          ...(values.note ? { note: values.note } : {}),
        },
      },
      { onSuccess: () => { form.reset(); onClose(); } },
    );
  };

  return (
    <Dialog open={open} title={`Issue ${asset.code}`} onClose={onClose}>
      {!keeperId ? (
        <KeeperRequired />
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          {asset.activeReservation && (
            <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
              Reserved right now for{" "}
              <span className="font-medium">{asset.activeReservation.worker?.name ?? "someone"}</span>.
              Issuing to them collects the reservation and links it to this movement; issuing to
              anyone else is refused.
            </p>
          )}

          {asset.requiredCertification && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Requires the {asset.requiredCertification} certificate. The server refuses this if
              the worker&apos;s certificate had expired on the date of issue.
            </p>
          )}

          <Field label="Worker" error={form.formState.errors.workerId?.message}>
            <select className={inputClass} {...form.register("workerId")}>
              <option value="">Pick a worker…</option>
              {workers?.workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.employeeNo})
                </option>
              ))}
            </select>
          </Field>

          <Field label="When it happened" hint="Leave blank for now. Late entries are expected.">
            <input type="datetime-local" className={inputClass} {...form.register("occurredAt")} />
          </Field>

          <Field label="Due back" hint="Optional. Used to derive 'overdue'.">
            <input type="datetime-local" className={inputClass} {...form.register("dueAt")} />
          </Field>

          <Field label="Note">
            <input type="text" className={inputClass} {...form.register("note")} />
          </Field>

          {write.error && <ErrorBanner error={write.error} />}

          <SubmitRow pending={write.isPending} submitLabel="Issue" onCancel={onClose} />
        </form>
      )}
    </Dialog>
  );
}

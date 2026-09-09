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
import { formatDateTime, fromLocalInputValue, toLocalInputValue } from "@/lib/dates";
import type { TimelineEntry } from "@/lib/types";

const schema = z.object({
  correctionReason: z.string().min(1, "Say what was wrong."),
  occurredAt: z.string().optional(),
  workerId: z.string().optional(),
  returnedByWorkerId: z.string().optional(),
});

type Values = z.infer<typeof schema>;

/**
 * Writes a correction, which is a new movement pointing at this one - never
 * an edit. Only fields the keeper changes are sent; everything else carries
 * forward from the original (FR-18).
 */
export function CorrectDialog({
  movement,
  open,
  onClose,
}: {
  movement: TimelineEntry;
  open: boolean;
  onClose: () => void;
}) {
  const { keeperId } = useKeeperStore();
  const { data: workers } = useWorkers();
  const idempotencyKey = useIdempotencyKey(open);
  const write = useWrite({ successMessage: () => "Correction recorded. The original stays visible." });

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      correctionReason: "",
      occurredAt: toLocalInputValue(new Date(movement.occurredAt)),
      workerId: movement.worker?.id ?? "",
      returnedByWorkerId: movement.returnedBy?.id ?? "",
    },
  });

  const onSubmit = (values: Values) => {
    if (!keeperId) return;
    write.mutate(
      {
        path: `/movements/${movement.id}/corrections`,
        idempotencyKey,
        body: {
          keeperId,
          correctionReason: values.correctionReason,
          ...(values.occurredAt ? { occurredAt: fromLocalInputValue(values.occurredAt) } : {}),
          ...(values.workerId && values.workerId !== movement.worker?.id
            ? { workerId: values.workerId }
            : {}),
          ...(values.returnedByWorkerId && values.returnedByWorkerId !== movement.returnedBy?.id
            ? { returnedByWorkerId: values.returnedByWorkerId }
            : {}),
        },
      },
      { onSuccess: () => { form.reset(); onClose(); } },
    );
  };

  const isIssue = movement.type === "ISSUE";

  return (
    <Dialog open={open} title="Correct this entry" onClose={onClose}>
      {!keeperId ? (
        <KeeperRequired />
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-700">
            Correcting <span className="font-medium">{movement.type}</span> from{" "}
            {formatDateTime(movement.occurredAt)}. Nothing is edited or deleted — this writes a new
            entry and strikes the old one through. The server refuses a correction that would leave
            the asset&apos;s timeline invalid.
          </p>

          <Field label="What was wrong" error={form.formState.errors.correctionReason?.message}>
            <input type="text" className={inputClass} {...form.register("correctionReason")} />
          </Field>

          <Field label="When it actually happened">
            <input type="datetime-local" className={inputClass} {...form.register("occurredAt")} />
          </Field>

          {isIssue && (
            <Field label="Who actually took it">
              <select className={inputClass} {...form.register("workerId")}>
                <option value="">Unchanged</option>
                {workers?.workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.employeeNo})
                  </option>
                ))}
              </select>
            </Field>
          )}

          {movement.type === "RETURN" && (
            <Field label="Who actually handed it back">
              <select className={inputClass} {...form.register("returnedByWorkerId")}>
                <option value="">Unchanged</option>
                {workers?.workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.employeeNo})
                  </option>
                ))}
              </select>
            </Field>
          )}

          {write.error && <ErrorBanner error={write.error} />}

          <SubmitRow pending={write.isPending} submitLabel="Record correction" onCancel={onClose} />
        </form>
      )}
    </Dialog>
  );
}

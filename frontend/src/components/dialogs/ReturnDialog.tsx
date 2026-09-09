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

const schema = z.object({
  condition: z.enum(["OK", "DAMAGED"]),
  returnedByWorkerId: z.string().optional(),
  occurredAt: z.string().optional(),
  note: z.string().max(1000).optional(),
});

type Values = z.infer<typeof schema>;

export function ReturnDialog({
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
    successMessage: (r) =>
      r.asset?.status === "OUT_OF_SERVICE"
        ? `${asset.code} returned damaged and taken out of service.`
        : `${asset.code} is back in the store.`,
  });

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { condition: "OK", returnedByWorkerId: "" },
  });

  const onSubmit = (values: Values) => {
    if (!keeperId) return;
    write.mutate(
      {
        path: "/movements/return",
        idempotencyKey,
        body: {
          assetId: asset.id,
          keeperId,
          condition: values.condition,
          ...(values.returnedByWorkerId ? { returnedByWorkerId: values.returnedByWorkerId } : {}),
          ...(values.occurredAt ? { occurredAt: fromLocalInputValue(values.occurredAt) } : {}),
          ...(values.note ? { note: values.note } : {}),
        },
      },
      { onSuccess: () => { form.reset(); onClose(); } },
    );
  };

  return (
    <Dialog open={open} title={`Return ${asset.code}`} onClose={onClose}>
      {!keeperId ? (
        <KeeperRequired />
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <p className="text-xs text-zinc-600">
            Held by <span className="font-medium text-zinc-900">{asset.holder?.name ?? "—"}</span>.
          </p>

          <Field label="Condition" hint="Damaged also takes the asset out of service, at the same instant.">
            <select className={inputClass} {...form.register("condition")}>
              <option value="OK">OK</option>
              <option value="DAMAGED">Damaged</option>
            </select>
          </Field>

          <Field
            label="Handed in by"
            hint="Leave blank if the holder brought it back themselves. A colleague may return it."
          >
            <select className={inputClass} {...form.register("returnedByWorkerId")}>
              <option value="">The holder</option>
              {workers?.workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.employeeNo})
                </option>
              ))}
            </select>
          </Field>

          <Field label="When it happened" hint="Leave blank for now.">
            <input type="datetime-local" className={inputClass} {...form.register("occurredAt")} />
          </Field>

          <Field label="Note">
            <input type="text" className={inputClass} {...form.register("note")} />
          </Field>

          {write.error && <ErrorBanner error={write.error} />}

          <SubmitRow pending={write.isPending} submitLabel="Take it back" onCancel={onClose} />
        </form>
      )}
    </Dialog>
  );
}

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

/**
 * The window checks are duplicated from the server on purpose, and only as
 * a convenience: the server owns these rules and refuses anything this
 * misses. What the client must never do is refuse something the server
 * would have accepted, so these stay deliberately no stricter.
 */
const schema = z
  .object({
    workerId: z.string().min(1, "Pick who it is for."),
    startsAt: z.string().min(1, "When does it start?"),
    endsAt: z.string().min(1, "When does it end?"),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    path: ["endsAt"],
    message: "A reservation must end after it starts.",
  })
  .refine((v) => new Date(v.startsAt).getTime() > Date.now(), {
    path: ["startsAt"],
    message: "A reservation must start in the future.",
  })
  .refine(
    (v) => new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime() <= 30 * 86_400_000,
    { path: ["endsAt"], message: "A reservation cannot span more than 30 days." },
  );

type Values = z.infer<typeof schema>;

export function ReserveDialog({
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
  const write = useWrite({ successMessage: () => `${asset.code} reserved.` });

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { workerId: "", startsAt: "", endsAt: "" },
  });

  const onSubmit = (values: Values) => {
    if (!keeperId) return;
    write.mutate(
      {
        path: "/reservations",
        idempotencyKey,
        body: {
          assetId: asset.id,
          workerId: values.workerId,
          keeperId,
          startsAt: fromLocalInputValue(values.startsAt),
          endsAt: fromLocalInputValue(values.endsAt),
        },
      },
      { onSuccess: () => { form.reset(); onClose(); } },
    );
  };

  return (
    <Dialog open={open} title={`Reserve ${asset.code}`} onClose={onClose}>
      {!keeperId ? (
        <KeeperRequired />
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
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

          <Field label="From" error={form.formState.errors.startsAt?.message}>
            <input type="datetime-local" className={inputClass} {...form.register("startsAt")} />
          </Field>

          <Field
            label="Until"
            hint="Windows are half-open: one ending at 10:00 and one starting at 10:00 both stand."
            error={form.formState.errors.endsAt?.message}
          >
            <input type="datetime-local" className={inputClass} {...form.register("endsAt")} />
          </Field>

          {write.error && <ErrorBanner error={write.error} />}

          <SubmitRow pending={write.isPending} submitLabel="Reserve" onCancel={onClose} />
        </form>
      )}
    </Dialog>
  );
}

import { Checkbox, Field, Label } from "@headlessui/react";
import { CheckIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";
import { PERM } from "@/lib/permissions";
import { usePermissionList } from "../hooks/queries";

type Props = { value: number; onChange: (value: number) => void; allowAdmin?: boolean };

const PermissionEditor = ({ value, onChange, allowAdmin = true }: Props) => {
  const { data } = usePermissionList();
  const isAdmin = (value & PERM.ADMIN) !== 0;

  return (
    <div className="grid gap-1 sm:grid-cols-2">
      {(data ?? [])
        .filter((p) => allowAdmin || p.bit !== PERM.ADMIN)
        .map((p) => {
          const checked = (value & p.bit) !== 0 || (isAdmin && p.bit !== PERM.ADMIN);
          const disabled = isAdmin && p.bit !== PERM.ADMIN;
          return (
            <Field
              key={p.key}
              disabled={disabled}
              className={clsx(
                "flex items-start gap-3 rounded-md p-2.5 transition",
                p.bit === PERM.ADMIN ? "bg-primary-muted sm:col-span-2" : "hover:bg-white/[0.03]",
              )}
            >
              <Checkbox
                checked={checked}
                onChange={(on) => onChange(on ? value | p.bit : value & ~p.bit)}
                className="group mt-0.5 grid size-4 shrink-0 place-items-center rounded border border-line-strong data-[checked]:border-primary data-[checked]:bg-primary data-[disabled]:opacity-50"
              >
                <CheckIcon className="hidden size-3 text-on-primary group-data-[checked]:block" />
              </Checkbox>
              <div className="min-w-0">
                <Label className="text-sm font-medium data-[disabled]:opacity-60">{p.label}</Label>
                <p className="text-xs text-muted">{p.description}</p>
              </div>
            </Field>
          );
        })}
    </div>
  );
};

export default PermissionEditor;

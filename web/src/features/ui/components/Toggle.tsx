import { Field, Label, Switch } from "@headlessui/react";
import clsx from "clsx";
import type { ReactNode } from "react";

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
};

const Toggle = ({ checked, onChange, label, description, disabled, className }: Props) => (
  <Field disabled={disabled} className={clsx("flex items-start justify-between gap-4", className)}>
    {(label || description) && (
      <div className="min-w-0">
        {label && <Label className="text-sm font-medium">{label}</Label>}
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
    )}
    <Switch
      checked={checked}
      onChange={onChange}
      className="group relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-white/15 transition-colors data-[checked]:bg-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
    >
      <span className="size-4 translate-x-1 rounded-full bg-white shadow transition group-data-[checked]:translate-x-6 group-data-[checked]:bg-on-primary" />
    </Switch>
  </Field>
);

export default Toggle;

import {
  Description,
  Field as HField,
  Input as HInput,
  Label,
  Textarea as HTextarea,
  type InputProps,
  type TextareaProps,
} from "@headlessui/react";
import clsx from "clsx";
import type { ReactNode } from "react";

const control =
  "block w-full rounded-md border border-line bg-white/[0.04] px-3 text-sm text-fg placeholder:text-subtle transition-colors focus:border-primary/60 focus:bg-white/[0.06] focus:outline-none data-[disabled]:opacity-50";

export const Input = ({ className, ...props }: InputProps & { className?: string }) => (
  <HInput className={clsx(control, "h-10", className)} {...props} />
);

export const Textarea = ({ className, ...props }: TextareaProps & { className?: string }) => (
  <HTextarea className={clsx(control, "min-h-24 py-2", className)} {...props} />
);

type FieldProps = {
  label?: ReactNode;
  description?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
};

const Field = ({ label, description, error, children, className }: FieldProps) => (
  <HField className={clsx("space-y-1.5", className)}>
    {label && <Label className="block text-sm font-medium text-fg">{label}</Label>}
    {children}
    {description && !error && <Description className="text-xs text-muted">{description}</Description>}
    {error && <p className="text-xs text-danger">{error}</p>}
  </HField>
);

export default Field;

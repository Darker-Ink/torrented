import { Button as HButton, type ButtonProps } from "@headlessui/react";
import clsx from "clsx";
import { forwardRef } from "react";
import Spinner from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "light";
type Size = "sm" | "md" | "lg";

type Props = ButtonProps & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  className?: string;
};

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover data-[disabled]:bg-primary/40",
  light: "bg-white text-black hover:bg-white/85 data-[disabled]:bg-white/40",
  secondary: "bg-white/10 text-fg hover:bg-white/15 backdrop-blur-sm data-[disabled]:text-muted",
  ghost: "text-muted hover:bg-white/5 hover:text-fg data-[disabled]:opacity-50",
  danger: "bg-danger/15 text-danger hover:bg-danger/25 data-[disabled]:opacity-50",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2.5",
};

const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }, ref) => (
    <HButton
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md font-semibold whitespace-nowrap transition-colors duration-150 data-[disabled]:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {(bag) => (
        <>
          {loading && <Spinner size="sm" className="border-current/30 border-t-current" />}
          {typeof children === "function" ? children(bag) : children}
        </>
      )}
    </HButton>
  ),
);

Button.displayName = "Button";

export default Button;

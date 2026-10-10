import clsx from "clsx";

type Props = { size?: "sm" | "md" | "lg"; className?: string };

const sizes = { sm: "size-4 border-2", md: "size-6 border-2", lg: "size-10 border-[3px]" };

const Spinner = ({ size = "md", className }: Props) => (
  <span
    role="status"
    aria-label="Loading"
    className={clsx(
      "inline-block animate-spin rounded-full border-white/15 border-t-primary",
      sizes[size],
      className,
    )}
  />
);

export default Spinner;

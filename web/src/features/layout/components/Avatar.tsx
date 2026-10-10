import clsx from "clsx";

const palette = ["#a0c4eb", "#c3a6e8", "#8bd5a6", "#f6c177", "#f28b82", "#7fd1d8"];

type Props = { name: string; className?: string };

const Avatar = ({ name, className }: Props) => {
  const hash = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const color = palette[hash % palette.length];
  return (
    <span
      className={clsx("grid size-8 shrink-0 place-items-center rounded-md text-sm font-bold text-black/80", className)}
      style={{ background: color }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
};

export default Avatar;

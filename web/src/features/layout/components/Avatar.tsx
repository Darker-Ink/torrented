import clsx from "clsx";

const gradients = [
  ["#a0c4eb", "#6f97c9"],
  ["#c7b3ee", "#8f74cf"],
  ["#9fe0bd", "#5fae86"],
  ["#f7cf92", "#d79a4f"],
  ["#f3a9a2", "#cf6d63"],
  ["#93dce3", "#4fa6b0"],
];

type Props = { name: string; className?: string };

const Avatar = ({ name, className }: Props) => {
  const hash = [...name].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 7);
  const [from, to] = gradients[hash % gradients.length];
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <span
      className={clsx(
        "grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-bold text-black/75 ring-1 ring-black/10 ring-inset",
        className,
      )}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      {initials || "?"}
    </span>
  );
};

export default Avatar;

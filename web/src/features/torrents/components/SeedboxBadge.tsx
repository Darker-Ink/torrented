import Badge from "@/features/ui/components/Badge";
import type { SeedboxState } from "@/lib/types";

/** What the seedbox has for a torrent. Renders nothing without a seedbox. */
const SeedboxBadge = ({ state }: { state: SeedboxState | null | undefined }) => {
  if (!state) return null;
  switch (state.state) {
    case "ready":
      return <Badge tone="success">On TorBox</Badge>;
    case "downloading":
      return <Badge tone="primary">TorBox {Math.round(state.progress * 100)}%</Badge>;
    case "missing":
      return <Badge>Not on TorBox</Badge>;
    case "error":
      return (
        <span title={state.error}>
          <Badge tone="danger">TorBox error</Badge>
        </span>
      );
  }
};

export default SeedboxBadge;

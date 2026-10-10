import { UserIcon } from "@heroicons/react/24/solid";
import { img } from "@/lib/images";
import type { CastMember } from "@/lib/types";
import MediaRow from "./MediaRow";

const CastRow = ({ cast }: { cast: CastMember[] }) =>
  cast.length === 0 ? null : (
    <MediaRow title="Cast">
      {cast.map((c, i) => (
        <div key={`${c.name}-${i}`} className="w-28 shrink-0 snap-start space-y-2 text-center sm:w-32">
          <div className="mx-auto aspect-square w-24 overflow-hidden rounded-full bg-surface ring-1 ring-line sm:w-28">
            {c.profile_path ? (
              <img src={img(c.profile_path, "w185")} alt="" loading="lazy" className="size-full object-cover" />
            ) : (
              <UserIcon className="m-auto mt-5 size-14 text-subtle" />
            )}
          </div>
          <div>
            <p className="truncate text-sm font-semibold">{c.name}</p>
            {c.character && <p className="truncate text-xs text-muted">{c.character}</p>}
          </div>
        </div>
      ))}
    </MediaRow>
  );

export default CastRow;

import { CheckIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useUser } from "@/features/auth/hooks/useSession";
import Badge from "@/features/ui/components/Badge";
import Button from "@/features/ui/components/Button";
import Field, { Textarea } from "@/features/ui/components/Field";
import Modal from "@/features/ui/components/Modal";
import { toast } from "@/features/ui/components/Toaster";
import { errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { img } from "@/lib/images";
import { can, PERM } from "@/lib/permissions";
import type { MediaRequest, RequestStatus } from "@/lib/types";
import { useRequestActions } from "../hooks/queries";

const statusTone: Record<RequestStatus, "warning" | "primary" | "danger" | "success"> = {
  pending: "warning",
  approved: "primary",
  declined: "danger",
  available: "success",
};

const statusLabel: Record<RequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  available: "Available",
};

const RequestCard = ({ request }: { request: MediaRequest }) => {
  const user = useUser();
  const { update, remove } = useRequestActions();
  const [declining, setDeclining] = useState(false);
  const [response, setResponse] = useState("");
  const manager = can(user, PERM.MANAGE_REQUESTS);
  const own = request.user_id === user?.id;
  const link = request.media_id ? `/title/${request.media_id}` : `/discover/${request.kind}/${request.tmdb_id}`;

  const act = async (status: RequestStatus, resp?: string) => {
    try {
      await update.mutateAsync({ id: request.id, status, response: resp });
      toast.success(status === "approved" ? `${request.title} added to the library` : "Request updated");
      setDeclining(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="relative flex gap-4 overflow-hidden rounded-xl border border-line bg-bg-raised p-4">
      {request.backdrop_path && (
        <img
          src={img(request.backdrop_path, "w780")}
          alt=""
          className="pointer-events-none absolute inset-0 size-full object-cover opacity-[0.07]"
        />
      )}
      <Link to={link} className="relative w-20 shrink-0 sm:w-24">
        {request.poster_path ? (
          <img src={img(request.poster_path, "w185")} alt="" className="aspect-[2/3] w-full rounded-md object-cover" />
        ) : (
          <div className="aspect-[2/3] w-full rounded-md bg-surface" />
        )}
      </Link>
      <div className="relative min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={link} className="font-semibold hover:underline">
              {request.title}
            </Link>
            <p className="text-xs text-muted">
              {request.kind === "tv" ? "Show" : "Movie"}
              {request.year ? ` · ${request.year}` : ""} · requested by {request.requested_by} {timeAgo(request.created_at)}
            </p>
          </div>
          <Badge tone={statusTone[request.status]}>{statusLabel[request.status]}</Badge>
        </div>
        {request.seasons && request.seasons.length > 0 && (
          <p className="text-xs text-muted">Seasons: {request.seasons.join(", ")}</p>
        )}
        {request.note && <p className="text-sm text-fg/80">“{request.note}”</p>}
        {request.response && (
          <p className="text-xs text-muted">
            {request.handled_by_name ?? "Staff"}: {request.response}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {manager && request.status === "pending" && (
            <>
              <Button size="sm" variant="primary" onClick={() => act("approved")} loading={update.isPending}>
                <CheckIcon className="size-4" /> Approve
              </Button>
              <Button size="sm" variant="danger" onClick={() => setDeclining(true)}>
                <XMarkIcon className="size-4" /> Decline
              </Button>
            </>
          )}
          {(manager || (own && request.status === "pending")) && (
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(request.id)} loading={remove.isPending}>
              {own && request.status === "pending" ? "Cancel request" : "Delete"}
            </Button>
          )}
          {request.media_id && request.status !== "declined" && (
            <Link to={`/title/${request.media_id}`}>
              <Button size="sm" variant="secondary">
                Open title
              </Button>
            </Link>
          )}
        </div>
      </div>

      <Modal
        open={declining}
        onClose={() => setDeclining(false)}
        title={`Decline ${request.title}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeclining(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => act("declined", response)} loading={update.isPending}>
              Decline
            </Button>
          </>
        }
      >
        <Field label="Reason" description="Optional — shown to the person who asked.">
          <Textarea value={response} onChange={(e) => setResponse(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
};

export default RequestCard;

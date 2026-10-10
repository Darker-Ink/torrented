import { InboxIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useUser } from "@/features/auth/hooks/useSession";
import RequestCard from "@/features/requests/components/RequestCard";
import { useRequests } from "@/features/requests/hooks/queries";
import Button from "@/features/ui/components/Button";
import EmptyState from "@/features/ui/components/EmptyState";
import Select from "@/features/ui/components/Select";
import { CardListSkeleton } from "@/features/ui/components/Skeleton";
import Tabs from "@/features/ui/components/Tabs";
import { can, PERM } from "@/lib/permissions";
import type { RequestStatus } from "@/lib/types";

const RequestList = ({ scope }: { scope: "mine" | "all" }) => {
  const [status, setStatus] = useState<RequestStatus | "">(scope === "all" ? "pending" : "");
  const { data, isLoading } = useRequests(scope, status || undefined);
  return (
    <div className="space-y-4">
      <Select
        className="w-48"
        value={status}
        onChange={setStatus}
        options={[
          { value: "", label: "Any status" },
          { value: "pending", label: "Pending" },
          { value: "approved", label: "Approved" },
          { value: "available", label: "Available" },
          { value: "declined", label: "Declined" },
        ]}
      />
      {isLoading ? (
        <CardListSkeleton count={4} media columns={2} />
      ) : data && data.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={InboxIcon}
          title="No requests"
          action={
            scope === "mine" ? (
              <Link to="/discover">
                <Button variant="primary">Find something to request</Button>
              </Link>
            ) : undefined
          }
        >
          {scope === "mine" ? "Ask for movies and shows that aren't in the library yet." : "Nothing matches this filter."}
        </EmptyState>
      )}
    </div>
  );
};

const RequestsPage = () => {
  const user = useUser();
  const manager = can(user, PERM.MANAGE_REQUESTS);
  return (
    <div className="space-y-6 px-4 pt-24 pb-10 sm:px-10">
      <h1 className="text-3xl font-black tracking-tight">Requests</h1>
      {manager ? (
        <Tabs
          tabs={[
            { key: "all", label: "Everyone's requests", content: <RequestList scope="all" /> },
            { key: "mine", label: "My requests", content: <RequestList scope="mine" /> },
          ]}
        />
      ) : (
        <RequestList scope="mine" />
      )}
    </div>
  );
};

export default RequestsPage;

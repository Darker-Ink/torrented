import AdminLayout from "@/features/admin/components/AdminLayout";
import NetworkSettings from "@/features/admin/components/NetworkSettings";
import { PERM } from "@/lib/permissions";

const NetworkPage = () => (
  <AdminLayout
    title="VPN & seedbox"
    description="How torrent traffic leaves this server, and where streams come from."
    requires={PERM.MANAGE_SETTINGS}
  >
    <NetworkSettings />
  </AdminLayout>
);

export default NetworkPage;

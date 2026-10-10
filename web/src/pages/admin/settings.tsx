import AdminLayout from "@/features/admin/components/AdminLayout";
import SettingsForm from "@/features/admin/components/SettingsForm";
import { PERM } from "@/lib/permissions";

const SettingsPage = () => (
  <AdminLayout title="Settings" description="Server-wide configuration." requires={PERM.MANAGE_SETTINGS}>
    <SettingsForm />
  </AdminLayout>
);

export default SettingsPage;

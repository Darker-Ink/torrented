import AdminLayout from "@/features/admin/components/AdminLayout";
import LibraryTransfer from "@/features/admin/components/LibraryTransfer";
import { PERM } from "@/lib/permissions";

const LibraryPage = () => (
  <AdminLayout
    title="Library"
    description="The library database is portable. Share it with friends or move it to another server."
    requires={PERM.MANAGE_LIBRARY}
  >
    <LibraryTransfer />
  </AdminLayout>
);

export default LibraryPage;

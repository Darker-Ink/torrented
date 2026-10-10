import { useState, type FormEvent } from "react";
import { useSetUser } from "@/features/auth/hooks/useSession";
import Button from "@/features/ui/components/Button";
import Field, { Input } from "@/features/ui/components/Field";
import { toast } from "@/features/ui/components/Toaster";
import { api, errorMessage } from "@/lib/api";
import type { User } from "@/lib/types";

const ProfileForm = ({ user }: { user: User }) => {
  const [name, setName] = useState(user.display_name ?? "");
  const [loading, setLoading] = useState(false);
  const setUser = useSetUser();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      setUser(await api.patch<User>("/auth/me", { display_name: name }));
      toast.success("Profile saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Username" description="Usernames can't be changed.">
        <Input value={user.username} disabled />
      </Field>
      <Field label="Display name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={user.username} />
      </Field>
      <Button type="submit" variant="primary" loading={loading}>
        Save
      </Button>
    </form>
  );
};

export default ProfileForm;

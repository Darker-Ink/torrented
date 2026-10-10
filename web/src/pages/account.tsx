import { useQueryClient } from "@tanstack/react-query";
import PasswordForm from "@/features/account/components/PasswordForm";
import ProfileForm from "@/features/account/components/ProfileForm";
import { useUser } from "@/features/auth/hooks/useSession";
import Avatar from "@/features/layout/components/Avatar";
import Badge from "@/features/ui/components/Badge";
import Button from "@/features/ui/components/Button";
import { toast } from "@/features/ui/components/Toaster";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";

const Section = ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
  <section className="grid gap-6 border-t border-line py-8 md:grid-cols-[16rem_1fr]">
    <div>
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </div>
    <div className="max-w-md">{children}</div>
  </section>
);

const AccountPage = () => {
  const user = useUser();
  const client = useQueryClient();
  if (!user) return null;

  const signOutEverywhere = async () => {
    try {
      await api.post("/auth/logout-all");
      client.clear();
      window.location.href = "/login";
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const name = user.display_name || user.username;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-24 pb-10 sm:px-10">
      <div className="flex items-center gap-4 pb-8">
        <Avatar name={name} className="size-16 text-2xl" />
        <div>
          <h1 className="text-2xl font-black">{name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted">
            <Badge tone="primary">{user.role}</Badge>
            <span>Member since {formatDate(user.created_at)}</span>
          </div>
        </div>
      </div>

      <Section title="Profile">
        <ProfileForm user={user} />
      </Section>
      <Section title="Password">
        <PasswordForm />
      </Section>
      <Section title="Sessions" description="Signs you out on every device, including this one.">
        <Button variant="danger" onClick={signOutEverywhere}>
          Sign out everywhere
        </Button>
      </Section>
      <Section title="What you can do">
        <div className="flex flex-wrap gap-1.5">
          {user.granted.map((g) => (
            <Badge key={g}>{g.replace(/_/g, " ")}</Badge>
          ))}
        </div>
      </Section>
    </div>
  );
};

export default AccountPage;

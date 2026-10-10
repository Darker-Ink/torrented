import AuthLayout from "@/features/auth/components/AuthLayout";
import SetupWizard from "@/features/auth/components/SetupWizard";

const SetupPage = () => (
  <AuthLayout title="Set up your server" subtitle="A couple of quick steps and you're streaming." wide>
    <SetupWizard />
  </AuthLayout>
);

export default SetupPage;

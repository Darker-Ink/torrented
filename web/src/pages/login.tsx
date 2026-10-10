import AuthLayout from "@/features/auth/components/AuthLayout";
import LoginForm from "@/features/auth/components/LoginForm";

const LoginPage = () => (
  <AuthLayout title="Welcome back" subtitle="Sign in to keep watching.">
    <LoginForm />
  </AuthLayout>
);

export default LoginPage;

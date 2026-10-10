import AuthLayout from "@/features/auth/components/AuthLayout";
import RegisterForm from "@/features/auth/components/RegisterForm";

const RegisterPage = () => (
  <AuthLayout title="Create your account">
    <RegisterForm />
  </AuthLayout>
);

export default RegisterPage;

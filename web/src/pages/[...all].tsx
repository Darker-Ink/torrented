import { Link } from "react-router-dom";

const NotFoundPage = () => (
  <div className="grid min-h-[70vh] place-items-center px-6 pt-16 text-center">
    <div className="space-y-3">
      <p className="text-6xl font-black text-primary">404</p>
      <p className="text-lg font-semibold">Lost your way?</p>
      <p className="text-muted">This page doesn't exist.</p>
      <Link to="/" className="inline-block pt-2 font-semibold text-primary hover:underline">
        Go home
      </Link>
    </div>
  </div>
);

export default NotFoundPage;

import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="container-max flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-headline-md font-bold text-primary">404</p>
      <h1 className="mt-2 text-title-lg font-semibold text-on-surface">Page not found</h1>
      <p className="mt-2 max-w-md text-body-md text-on-surface-variant">
        The page you are looking for does not exist or may have been moved.
      </p>
      <Link to="/" className="btn-primary mt-6">
        Back to home
      </Link>
    </div>
  );
}

import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="state state-empty">
      <h1>Page not found</h1>
      <p>That address doesn't match anything in TaskForge.</p>
      <Link to="/" className="btn">
        Back to dashboard
      </Link>
    </div>
  );
}

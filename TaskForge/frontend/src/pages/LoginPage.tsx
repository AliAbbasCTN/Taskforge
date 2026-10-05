import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { FormError } from '../components/Feedback';
import { FormField } from '../components/FormField';
import { useAuth } from '../contexts/AuthContext';
import { AuthLayout } from '../layouts/AuthLayout';

/**
 * WHAT: The login form - the first page that uses React STATE.
 *
 * `useState` gives a component memory between renders: each keystroke calls
 * a setter, React re-renders, and the input shows the new value. Inputs wired
 * this way (`value` + `onChange`) are called "controlled": React, not the
 * browser, owns what the field contains.
 *
 * There is no redirect after a successful login here. Logging in changes the
 * auth state, and `PublicOnlyRoute` (which wraps this page) reacts to that by
 * sending the user on. One mechanism, in one place.
 */
export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Without this the browser would reload the page to submit the form.
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Log in">
      <form onSubmit={handleSubmit} className="stack">
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError error={error} />
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="auth-switch">
        New to TaskForge? <Link to="/register">Create an account</Link>
      </p>
    </AuthLayout>
  );
}

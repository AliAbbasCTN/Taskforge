import type { ReactNode } from 'react';

/** The frame around login and register: a brand panel beside the form. */
export function AuthLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="brand-mark" aria-hidden="true">
          T
        </div>
        <h1 className="auth-tagline">Know what's moving, and what's stuck.</h1>
        <p>
          TaskForge keeps your team's projects, boards and tasks in one place,
          so everyone sees the same picture.
        </p>
      </aside>
      <main className="auth-form">
        <h2>{title}</h2>
        {children}
      </main>
    </div>
  );
}

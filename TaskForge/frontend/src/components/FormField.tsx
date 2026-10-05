import { useId, type InputHTMLAttributes } from 'react';

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

/**
 * A label tied to its input. `htmlFor`/`id` is what lets a screen reader
 * announce "Email" when the field is focused, and lets a click on the label
 * focus the input. `useId` generates an id that is unique per instance.
 *
 * NOTE: attributes like `required` and `minLength` give instant feedback, but
 * they are a courtesy only - a browser's dev tools can remove them in a second.
 * The backend validates every field again, and its messages are shown to the
 * user, because the server is the one validation that can't be bypassed.
 */
export function FormField({ label, hint, id, ...inputProps }: FormFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        aria-describedby={hint ? hintId : undefined}
        {...inputProps}
      />
      {hint && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

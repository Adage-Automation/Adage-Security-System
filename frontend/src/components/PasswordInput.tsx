import { forwardRef, InputHTMLAttributes, useState } from 'react';
import { IconEye, IconEyeOff } from './icons';

// Show/hide toggle for password fields — a near-universal convention that
// cuts mistyped-password friction, missing from every password field in
// the app until now. Wraps a plain <input>, so it drops into the existing
// `.field` markup unchanged. forwardRef so callers (e.g. a modal's
// autofocus-first-field ref) can reach the underlying <input>.
export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(
  { id, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-input">
      <input ref={ref} {...rest} id={id} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? <IconEyeOff /> : <IconEye />}
      </button>
    </div>
  );
});

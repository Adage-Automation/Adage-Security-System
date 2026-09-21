import { InputHTMLAttributes, useState } from 'react';
import { IconEye, IconEyeOff } from './icons';

// Show/hide toggle for password fields — a near-universal convention that
// cuts mistyped-password friction, missing from every password field in
// the app until now. Wraps a plain <input>, so it drops into the existing
// `.field` markup unchanged.
export function PasswordInput({ id, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-input">
      <input {...rest} id={id} type={visible ? 'text' : 'password'} />
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
}

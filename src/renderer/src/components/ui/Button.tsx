import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { Icon, type IconName } from '../Icon';

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' }) {
  return <button {...props} type={type} className={`ui-button ui-button-${variant} ${className}`} />;
}

/** Native title supplies a platform tooltip; the accessible label survives icon-only navigation. */
export function IconButton({ icon, label, className = '', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: IconName; label: string }) {
  return <Button {...props} variant="quiet" className={`ui-icon-button ${className}`} aria-label={label} title={props.title ?? label}><Icon name={icon} size={18} /></Button>;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`ui-input ${className}`} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`ui-select ${className}`} />;
}

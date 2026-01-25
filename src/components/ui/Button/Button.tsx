import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'xs' | 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size,
      loading = false,
      icon,
      iconOnly = false,
      disabled,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const classNames = [
      styles.btn,
      styles[variant],
      size && styles[size],
      iconOnly && styles.iconOnly,
      loading && styles.loading,
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        className={classNames}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <span className={styles.spinner} />}
        {icon}
        {!iconOnly && children}
      </button>
    );
  }
);

Button.displayName = 'Button';

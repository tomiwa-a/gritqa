import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const button = cva(
  [
    'group relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-medium rounded-md select-none',
    'transition-[background-color,border-color,color,box-shadow] duration-150 ease-out',
    'disabled:pointer-events-none disabled:opacity-45',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-ink text-ink-inverse hover:bg-space-indigo shadow-[0_1px_2px_rgba(27,29,46,0.16)]',
        accent: 'bg-punch-red text-white hover:bg-classic-crimson shadow-[0_1px_2px_rgba(216,0,50,0.2)]',
        secondary: 'bg-surface text-ink border border-rule-strong hover:border-ink hover:bg-surface-sunken',
        ghost: 'text-ink-muted hover:text-ink hover:bg-surface-sunken',
        onDark: 'bg-ink-inverse text-ink hover:bg-white',
        ghostDark: 'text-ink-dim border border-rule-dark hover:text-ink-inverse hover:border-ink-subtle',
        danger: 'bg-app-panel text-fail border border-fail/30 hover:border-fail hover:bg-fail-soft',
      },
      size: {
        xs: 'h-7 px-2.5 text-[12.5px]',
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-[0.9375rem]',
        icon: 'h-8 w-8',
        iconSm: 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

type ButtonBaseProps = VariantProps<typeof button> & {
  children: React.ReactNode;
  trailing?: boolean;
  className?: string;
};

export type ButtonProps = ButtonBaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

export type ButtonLinkProps = ButtonBaseProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children'>;

function Arrow() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="h-3.5 w-3.5 transition-transform duration-200 ease-out group-hover:translate-x-0.5"
    >
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Button({ variant, size, trailing, children, className, ...rest }: ButtonProps) {
  return (
    <button className={cn(button({ variant, size }), className)} {...rest}>
      {children}
      {trailing && <Arrow />}
    </button>
  );
}

export function ButtonLink({ variant, size, trailing, children, className, ...rest }: ButtonLinkProps) {
  return (
    <a className={cn(button({ variant, size }), className)} {...rest}>
      {children}
      {trailing && <Arrow />}
    </a>
  );
}

export const buttonVariants = button;

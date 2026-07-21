import { ReactNode } from "react";
import appliedLogo from "@/assets/appliedlogo.jpeg";

interface AuthShellProps {
  /** Optional override for the header brand image. */
  brandIconUrl?: string;
  /** Right-side mode badge (Staff/Tablet chip on Login). Optional. */
  badge?: ReactNode;
  /** Card title. */
  title: string;
  /** Card subtitle. */
  subtitle?: string;
  /** Card body. */
  children: ReactNode;
  /** Optional maximum width override. */
  maxWidthClass?: string;
}

/**
 * Shared visual shell for every authentication surface (Login, OAuth Consent,
 * password reset, etc.). Simple centered card: dark blue brand header on top,
 * clean form body below. Presentation-only — no auth logic here.
 */
export function AuthShell({
  brandIconUrl,
  badge,
  title,
  subtitle,
  children,
  maxWidthClass = "max-w-[440px]",
}: AuthShellProps) {
  const logoSrc = brandIconUrl ?? appliedLogo;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-8">
      <div className={`w-full ${maxWidthClass}`}>
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
          {/* Brand header */}
          <div
            className="flex items-center justify-center px-6 py-10"
            style={{ backgroundColor: "#1E3A8A" }}
          >
            <img
              src={logoSrc}
              alt="Applied Nutrition"
              className="h-16 w-auto object-contain"
            />
          </div>

          {/* Body */}
          <div className="px-6 py-8 sm:px-8">
            <div className="mb-6 text-center">
              <div className="flex items-center justify-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  {title}
                </h1>
                {badge}
              </div>
              {subtitle && (
                <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
              )}
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

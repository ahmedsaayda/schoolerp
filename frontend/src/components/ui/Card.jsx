/**
 * Carte du design system (bordure légère, rayon 2xl — aligné sur les pages ERP existantes).
 */
export function Card({ className = "", children, ...props }) {
  return (
    <div
      className={`rounded-2xl border border-[#e2e8f0] bg-white shadow-sm ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = "", children, ...props }) {
  return (
    <div className={`border-b border-[#f1f5f9] px-6 py-4 ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className = "", children, ...props }) {
  return (
    <h3 className={`text-base font-semibold text-[#0f172a] ${className}`} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ className = "", children, ...props }) {
  return (
    <p className={`mt-1 text-xs leading-relaxed text-[#64748b] ${className}`} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className = "", children, ...props }) {
  return (
    <div className={`p-6 ${className}`} {...props}>
      {children}
    </div>
  );
}

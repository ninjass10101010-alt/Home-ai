import BottomNav from "./BottomNav";

interface PageShellProps {
  children: React.ReactNode;
  className?: string;
}

export default function PageShell({ children, className = "" }: PageShellProps) {
  return (
    <div className="min-h-screen bg-surface-0 max-w-lg mx-auto relative">
      <main className={`pb-28 ${className}`}>{children}</main>
      <BottomNav />
    </div>
  );
}

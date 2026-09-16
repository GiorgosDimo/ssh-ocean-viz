'use client';

interface SshReadoutProps {
  value: string | null;
}

export default function SshReadout({ value }: SshReadoutProps) {
  if (!value) return null;
  return (
    <div className="absolute bottom-[220px] sm:bottom-20 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
      <div className="bg-black/70 backdrop-blur text-white px-4 py-2 rounded-xl shadow-lg flex items-baseline gap-1.5">
        <span className="text-xs text-white/60 font-medium">SSH</span>
        <span className="text-lg font-bold tabular-nums">{value}</span>
      </div>
    </div>
  );
}

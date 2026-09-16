'use client';

interface PlaybackControlsProps {
  isPlaying:    boolean;
  position:     number;
  maxPosition:  number;
  dateLabel:    string;
  startDateLabel: string;
  endDateLabel: string;
  speed:        number;
  speedMin:     number;
  speedMax:     number;
  onPlay:       () => void;
  onPause:      () => void;
  onReset:      () => void;
  onSpeedChange: (speed: number) => void;
  onScrubStart:  () => void;
  onScrub:       (position: number) => void;
  onScrubEnd:    () => void;
}

export default function PlaybackControls({
  isPlaying,
  position,
  maxPosition,
  dateLabel,
  startDateLabel,
  endDateLabel,
  speed,
  speedMin,
  speedMax,
  onPlay,
  onPause,
  onReset,
  onSpeedChange,
  onScrubStart,
  onScrub,
  onScrubEnd,
}: PlaybackControlsProps) {
  const speedPct    = Math.round(speed * 100);
  const speedMinPct = Math.round(speedMin * 100);
  const speedMaxPct = Math.round(speedMax * 100);

  return (
    // Mobile: vertical stack filling the bottom sheet.
    // sm+: single horizontal row (original layout).
    <div className="flex flex-col gap-2 w-full sm:flex-row sm:items-center sm:gap-3 sm:w-auto">

      {/* ── Row 1 (mobile) / inline (desktop): transport + date label ── */}
      <div className="flex items-center gap-2">
        <button
          onClick={onReset}
          title="Reset to start"
          aria-label="Reset to start"
          className="px-2 py-1.5 sm:px-3 sm:py-1 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all"
        >
          ⏮<span className="hidden sm:inline"> Reset</span>
        </button>

        {isPlaying ? (
          <button
            onClick={onPause}
            title="Pause"
            aria-label="Pause"
            className="px-2 py-1.5 sm:px-3 sm:py-1 rounded-lg text-sm font-medium bg-amber-100 hover:bg-amber-200 active:scale-95 transition-all"
          >
            ⏸<span className="hidden sm:inline"> Pause</span>
          </button>
        ) : (
          <button
            onClick={onPlay}
            title="Play"
            aria-label="Play"
            className="px-2 py-1.5 sm:px-3 sm:py-1 rounded-lg text-sm font-medium bg-green-100 hover:bg-green-200 active:scale-95 transition-all"
          >
            ▶<span className="hidden sm:inline"> Play</span>
          </button>
        )}

        {/* Date label — shown inline with transport on mobile */}
        <span className="sm:hidden flex-1 text-center text-sm font-semibold text-gray-800 tabular-nums truncate">
          {dateLabel}
        </span>

        {/* Speed badge — mobile only quick-read */}
        <span className="sm:hidden text-xs font-medium text-gray-500 tabular-nums">{speedPct}%</span>
      </div>

      {/* ── Timeline scrubber ── */}
      <div className="flex flex-col gap-0.5 w-full sm:min-w-[260px] sm:w-auto">
        {/* Date / end header — desktop only (mobile shows date in row 1) */}
        <div className="hidden sm:flex justify-between text-[10px] text-gray-500 tabular-nums px-0.5">
          <span className="font-semibold text-gray-700">{dateLabel}</span>
          <span>{endDateLabel}</span>
        </div>
        <input
          type="range"
          min={0}
          max={maxPosition}
          step={maxPosition / 1000}
          value={position}
          onPointerDown={onScrubStart}
          onChange={(e) => onScrub(Number(e.target.value))}
          onPointerUp={onScrubEnd}
          className="w-full h-2 accent-blue-500 cursor-pointer"
          title={dateLabel}
        />
        <div className="flex justify-between text-[9px] text-gray-400 px-0.5">
          <span>{startDateLabel}</span>
          <span>{endDateLabel}</span>
        </div>
      </div>

      {/* ── Speed slider ── */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 whitespace-nowrap">Speed</span>
        <input
          type="range"
          min={speedMinPct}
          max={speedMaxPct}
          step={5}
          value={speedPct}
          onChange={(e) => onSpeedChange(Number(e.target.value) / 100)}
          className="w-full sm:w-20 h-1.5 accent-blue-500 cursor-pointer"
          title={`${speedPct}%`}
        />
        <span className="text-xs font-medium text-gray-700 w-10 tabular-nums text-right">
          {speedPct}%
        </span>
      </div>
    </div>
  );
}

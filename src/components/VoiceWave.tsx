// Live sound-wave bar and partial transcript shown while the mic is recording.
import type { FC } from 'react';

const BARS = 32;

export const VoiceWave: FC<{ levels: number[]; partial?: string; active: boolean }> = ({ levels, partial, active }) => {
  if (!active) return null;

  // Show the newest BARS levels, padded on the left with silence.
  const bars = Array.from({ length: BARS }, (_, i) => {
    const idx = levels.length - BARS + i;
    return idx >= 0 ? levels[idx] : 0;
  });

  return (
    <div className="mt-1.5 flex flex-col items-center gap-1 w-full">
      <p
        aria-live="polite"
        className="line-clamp-2 w-full text-center text-[13px] italic text-slate-600 dark:text-slate-300"
      >
        {partial ?? ''}
      </p>
      <div className="flex h-10 w-full items-center justify-center gap-[3px]" aria-hidden="true">
        {bars.map((level, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-[#0f8b8d] transition-[height] duration-100 ease-out"
            style={{ height: `${4 + Math.max(0, Math.min(1, level)) * 32}px` }}
          />
        ))}
      </div>
    </div>
  );
};

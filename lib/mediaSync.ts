/**
 * mediaSync — lightweight replacement for MCorp.mediaSync
 *
 * Keeps an HTMLVideoElement in sync with a TimingObject by:
 *  1. Seeking to the timing position when drift exceeds `tolerance` seconds.
 *  2. Playing / pausing the video to match the timing velocity.
 *
 * The original library (https://mcorp.no/lib/mediasync.js) has no npm package,
 * so this covers the subset of its API that the SSH visualiser actually uses.
 *
 * Usage:
 *   const handle = mediaSync(videoEl, timingObject);
 *   // later:
 *   handle.destroy();
 */

import type { TimingObject } from './TimingObject';

export interface MediaSyncHandle {
  destroy: () => void;
}

export function mediaSync(
  video: HTMLVideoElement,
  timingObject: TimingObject,
  {
    tolerance = 0.1,
    /**
     * Maps the timing-object position to the video's actual time.
     * speedRatio = videoDuration / timelineDuration
     * e.g. a 3-second video on a 20-second timeline → speedRatio = 3/20 = 0.15
     * Default 1 (video duration equals timeline duration).
     */
    speedRatio = 1,
  }: { tolerance?: number; speedRatio?: number } = {},
): MediaSyncHandle {
  const sync = () => {
    const { position, velocity } = timingObject.query();
    // Map the timeline position to the video's own time coordinate
    const targetTime = position * speedRatio;

    // ── Seek if drifted ────────────────────────────────────────────────────
    if (Math.abs(video.currentTime - targetTime) > tolerance) {
      video.currentTime = targetTime;
    }

    // ── Match play / pause state ───────────────────────────────────────────
    const effectiveRate = velocity * speedRatio;
    if (velocity !== 0) {
      if (effectiveRate < 0.07) {
        // Below Chrome/Safari's minimum reliable playback rate (~0.0625).
        // Keep the video paused and rely entirely on seeking for sync — the
        // mediaSync tolerance-check above handles frame placement.
        if (!video.paused) video.pause();
      } else {
        video.playbackRate = effectiveRate;
        if (video.paused) {
          video.play().catch(() => {
            setTimeout(() => video.play().catch(() => undefined), 200);
          });
        }
      }
    } else {
      if (!video.paused) video.pause();
    }
  };

  timingObject.on('timeupdate', sync);
  // Run immediately so the video state matches before the first timeupdate fires
  sync();

  return {
    destroy() {
      timingObject.off('timeupdate', sync);
    },
  };
}

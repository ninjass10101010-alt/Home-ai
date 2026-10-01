/**
 * Queue state machine — the decisions both player surfaces share.
 *
 * These are pure functions precisely so the rules that are easy to get wrong
 * (does the queue wrap? does removing the current track stop playback? does a
 * seek clamp?) are pinned by tests instead of by whatever the UI happens to do.
 *
 * Run: npx vitest run tests/unit/media-queue.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  INITIAL_PLAYBACK_STATE,
  currentTrack,
  formatDuration,
  jumpTo,
  nextIndex,
  playTracks,
  progressFraction,
  removeFromQueue,
  replaceQueue,
  seek,
  setVolume,
  step,
  streamUrlFor,
  tick,
  toggleMute,
  togglePlay,
  type PlaybackState,
} from "@/lib/media/queue";
import type { MediaTrack } from "@/lib/media/youtube";

function track(id: string, seconds: number | null = 200): MediaTrack {
  return {
    id,
    title: `Track ${id}`,
    artist: "Artist",
    album: "",
    durationSeconds: seconds,
    artworkUrl: null,
    source: "youtube_music",
  };
}

function queueOf(...ids: string[]): PlaybackState {
  return { ...INITIAL_PLAYBACK_STATE, queue: ids.map((id) => track(id)), index: 0 };
}

/** A one-track queue that is actually playing, with a chosen duration. */
function playing(durationSeconds: number | null): PlaybackState {
  return {
    ...INITIAL_PLAYBACK_STATE,
    queue: [track("a", durationSeconds)],
    index: 0,
    status: "playing",
  };
}

describe("queue construction", () => {
  it("starts empty and idle", () => {
    expect(currentTrack(INITIAL_PLAYBACK_STATE)).toBeNull();
    expect(progressFraction(INITIAL_PLAYBACK_STATE)).toBe(0);
  });

  it("replaceQueue plays the first track and reports the change", () => {
    const { state, trackChanged } = replaceQueue(INITIAL_PLAYBACK_STATE, [track("a"), track("b")]);
    expect(state.index).toBe(0);
    expect(state.status).toBe("playing");
    expect(state.positionSeconds).toBe(0);
    expect(trackChanged).toBe(true);
  });

  it("replaceQueue with nothing loaded clears to idle", () => {
    const { state } = replaceQueue(queueOf("a"), []);
    expect(state.status).toBe("idle");
    expect(state.index).toBe(-1);
    expect(currentTrack(state)).toBeNull();
  });

  it("playTracks appends to an existing queue", () => {
    const first = replaceQueue(INITIAL_PLAYBACK_STATE, [track("a")]).state;
    const { state } = playTracks(first, [track("b")]);
    expect(state.queue.map((t) => t.id)).toEqual(["a", "b"]);
    expect(state.index).toBe(0);
  });

  it("playTracks with an empty list is a no-op", () => {
    const { state, trackChanged } = playTracks(queueOf("a"), []);
    expect(state.queue).toHaveLength(1);
    expect(trackChanged).toBe(false);
  });
});

describe("nextIndex / step", () => {
  it("walks forward and backward through the queue", () => {
    const state = queueOf("a", "b", "c");
    expect(nextIndex(state, "off")).toBe(1);
    expect(nextIndex({ ...state, index: 2 }, "off", -1)).toBe(1);
  });

  it("stops at the end instead of wrapping when repeat is off", () => {
    const state = { ...queueOf("a", "b"), index: 1 };
    expect(nextIndex(state, "off")).toBe(-1);
    const { state: stopped } = step(state, "off");
    expect(stopped.status).toBe("idle");
    expect(currentTrack(stopped)).toBeNull();
  });

  it("stops at the start when stepping back with repeat off", () => {
    expect(nextIndex({ ...queueOf("a", "b"), index: 0 }, "off", -1)).toBe(-1);
  });

  it("wraps in both directions when repeat is all", () => {
    const state = { ...queueOf("a", "b"), index: 1 };
    expect(nextIndex(state, "all")).toBe(0);
    expect(nextIndex({ ...state, index: 0 }, "all", -1)).toBe(1);
  });

  it("repeat one holds the same track forward but still steps back", () => {
    const state = { ...queueOf("a", "b"), index: 1 };
    expect(nextIndex(state, "one")).toBe(1);
    expect(nextIndex(state, "one", -1)).toBe(0);
  });

  it("an empty queue has no next track", () => {
    expect(nextIndex(INITIAL_PLAYBACK_STATE, "all")).toBe(-1);
  });

  it("step reports a track change only when the index actually moved", () => {
    const state = { ...queueOf("a", "b"), index: 1 };
    expect(step(state, "off").trackChanged).toBe(true);
    expect(step(state, "one").trackChanged).toBe(false);
  });

  it("clearing the index on stop is what the surfaces read as 'nothing playing'", () => {
    // The UI renders `currentTrack(state)`; leaving the index pointing at the
    // old track would show a paused song that is no longer loaded.
    const stopped = step({ ...queueOf("a", "b"), index: 1 }, "off").state;
    expect(currentTrack(stopped)).toBeNull();
    expect(stopped.status).toBe("idle");
  });
});

describe("jumpTo", () => {
  it("moves to a valid index and starts playing", () => {
    const { state } = jumpTo(queueOf("a", "b", "c"), 2);
    expect(state.index).toBe(2);
    expect(state.status).toBe("playing");
  });

  it("ignores an out-of-range index", () => {
    const state = queueOf("a", "b");
    expect(jumpTo(state, 9).state).toBe(state);
    expect(jumpTo(state, -1).state).toBe(state);
  });
});

describe("play/pause", () => {
  it("toggles between playing and paused", () => {
    const paused = togglePlay(playing(200));
    expect(paused.status).toBe("paused");
    expect(togglePlay(paused).status).toBe("playing");
  });

  it("does nothing with no track loaded", () => {
    expect(togglePlay(INITIAL_PLAYBACK_STATE)).toBe(INITIAL_PLAYBACK_STATE);
  });
});

describe("seek", () => {
  it("clamps to the track bounds", () => {
    const state = { ...playing(200), positionSeconds: 0 };
    expect(seek(state, 50).positionSeconds).toBe(50);
    expect(seek(state, -10).positionSeconds).toBe(0);
    expect(seek(state, 9_999).positionSeconds).toBe(200);
  });

  it("allows an open-ended seek when the duration is unknown", () => {
    expect(seek(playing(null), 4_000).positionSeconds).toBe(4_000);
  });
});

describe("volume", () => {
  it("clamps to 0-1 and unmutes on change", () => {
    expect(setVolume({ ...INITIAL_PLAYBACK_STATE, muted: true }, 0.4)).toMatchObject({
      volume: 0.4,
      muted: false,
    });
    expect(setVolume(INITIAL_PLAYBACK_STATE, 5).volume).toBe(1);
    expect(setVolume(INITIAL_PLAYBACK_STATE, -1).volume).toBe(0);
  });

  it("toggleMute flips the flag", () => {
    expect(toggleMute(INITIAL_PLAYBACK_STATE).muted).toBe(true);
    expect(toggleMute({ ...INITIAL_PLAYBACK_STATE, muted: true }).muted).toBe(false);
  });
});

describe("tick", () => {
  it("advances the clock while playing", () => {
    const state = { ...playing(300), positionSeconds: 0 };
    expect(tick(state, 10, "off").state.positionSeconds).toBe(10);
  });

  it("does not advance while paused", () => {
    const state: PlaybackState = { ...playing(300), status: "paused", positionSeconds: 0 };
    expect(tick(state, 10, "off").state.positionSeconds).toBe(0);
  });

  it("rolls into the next track at the end of the duration", () => {
    const state = { ...queueOf("a", "b"), index: 0, status: "playing" as const };
    const { state: next, trackChanged } = tick(state, 999, "off");
    expect(trackChanged).toBe(true);
    expect(next.index).toBe(1);
    expect(next.positionSeconds).toBe(0);
  });

  it("restarts the same track when repeat is one", () => {
    const state = { ...queueOf("a", "b"), index: 0, status: "playing" as const };
    const { state: next, trackChanged } = tick(state, 999, "one");
    expect(trackChanged).toBe(false);
    expect(next.index).toBe(0);
    expect(next.positionSeconds).toBe(0);
  });
});

describe("removeFromQueue", () => {
  it("keeps the current track when an earlier entry goes", () => {
    const state = { ...queueOf("a", "b", "c"), index: 2 };
    const { state: next } = removeFromQueue(state, "a");
    expect(next.queue.map((t) => t.id)).toEqual(["b", "c"]);
    expect(currentTrack(next)?.id).toBe("c");
  });

  it("moves to the next entry when the current one is removed", () => {
    const state = { ...queueOf("a", "b", "c"), index: 1 };
    expect(currentTrack(removeFromQueue(state, "b").state)?.id).toBe("c");
  });

  it("clamps to the last entry when the tail is removed", () => {
    const state = { ...queueOf("a", "b", "c"), index: 2 };
    expect(currentTrack(removeFromQueue(state, "c").state)?.id).toBe("b");
  });

  it("empties and idles when the last track is removed", () => {
    const { state } = removeFromQueue({ ...queueOf("a"), index: 0 }, "a");
    expect(state.queue).toEqual([]);
    expect(state.status).toBe("idle");
    expect(state.index).toBe(-1);
  });

  it("ignores an id that is not queued", () => {
    const state = queueOf("a");
    expect(removeFromQueue(state, "zzz").state).toBe(state);
  });
});

describe("formatDuration", () => {
  it("renders m:ss, and h:mm:ss past an hour", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3_661)).toBe("1:01:01");
  });

  it("renders a placeholder for an unknown duration", () => {
    expect(formatDuration(null)).toBe("--:--");
    expect(formatDuration(Number.NaN)).toBe("--:--");
    expect(formatDuration(-5)).toBe("--:--");
  });
});

describe("progressFraction", () => {
  it("is the ratio played, clamped to 0-1", () => {
    const state = { ...playing(200), positionSeconds: 50 };
    expect(progressFraction(state)).toBe(0.25);
    expect(progressFraction({ ...state, positionSeconds: 900 })).toBe(1);
    expect(progressFraction({ ...state, positionSeconds: -5 })).toBe(0);
  });

  it("is 0 when the duration is unknown", () => {
    expect(progressFraction({ ...playing(null), positionSeconds: 30 })).toBe(0);
  });
});

describe("streamUrlFor", () => {
  it("points at the local proxy and encodes the id", () => {
    expect(streamUrlFor("wU26xVT_vBU")).toBe("/api/media/stream?id=wU26xVT_vBU");
    expect(streamUrlFor("a b&c")).toBe("/api/media/stream?id=a%20b%26c");
  });

  it("never leaks an upstream host to the client", () => {
    expect(streamUrlFor("x")).not.toMatch(/googlevideo|youtube\.com/);
  });
});

/** Pure storyboard time planning: no API keys, network calls, or paid services. */
export const STORYBOARD_SCENE_COUNT = 12;
export const MAX_STORYBOARD_SECONDS = 360;

export function playableLyricLines(lyrics) {
  return String(lyrics ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^\[[^\]]+\]$/.test(line));
}

export function storyboardDurationSeconds(input = {}, lyrics = '') {
  const raw = input.durationSeconds ?? input.songDurationSeconds ?? input.audioDurationSeconds;
  if (raw !== undefined && raw !== null && raw !== '') {
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_STORYBOARD_SECONDS) {
      const error = new Error('Storyboard duration must be between 1 and 360 seconds; original audio is unchanged.');
      error.status = 400;
      throw error;
    }
    return Math.round(seconds);
  }
  const words = playableLyricLines(lyrics).join(' ').split(/\s+/).filter(Boolean).length;
  // Same fallback formula used by Android when recorded duration is unavailable.
  return Math.max(150, Math.min(360, Math.floor((words * 60) / 90) + 30));
}

export function storyboardSlot(durationSeconds, index, count = STORYBOARD_SCENE_COUNT) {
  if (!(durationSeconds >= 1) || !Number.isInteger(index) || index < 0 ||
      !Number.isInteger(count) || count < 1 || index >= count) {
    throw new RangeError('Invalid storyboard timeline slot');
  }
  const boundary = slot => Number((durationSeconds * slot / count).toFixed(3));
  return { startSeconds: boundary(index), endSeconds: boundary(index + 1) };
}

export function storyboardLyric(lyrics, index, count = STORYBOARD_SCENE_COUNT) {
  const lines = playableLyricLines(lyrics);
  if (!lines.length) return '';
  return lines[Math.min(lines.length - 1, Math.floor(index * lines.length / count))];
}

export function normalizedStoryboardScene(proposed, lyrics, durationSeconds, index,
  count = STORYBOARD_SCENE_COUNT) {
  const scene = proposed && typeof proposed === 'object' && !Array.isArray(proposed)
    ? proposed : {};
  const slot = storyboardSlot(durationSeconds, index, count);
  const lyric = typeof scene.lyric === 'string' && scene.lyric.trim()
    ? scene.lyric.trim() : storyboardLyric(lyrics, index, count);
  return {
    ...scene,
    ...slot,
    lyric,
    scene: typeof scene.scene === 'string' && scene.scene.trim()
      ? scene.scene.trim() : `Full-song storyboard beat ${index + 1}`,
    prompt: typeof scene.prompt === 'string' ? scene.prompt : ''
  };
}

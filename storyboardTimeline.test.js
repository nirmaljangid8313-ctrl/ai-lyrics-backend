import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORYBOARD_SCENE_COUNT, storyboardDurationSeconds, storyboardSlot,
  storyboardLyric, normalizedStoryboardScene
} from './storyboardTimeline.js';

test('12 scenes cover exactly a 270-second song without gaps or overlaps', () => {
  const timeline = Array.from({ length: STORYBOARD_SCENE_COUNT }, (_, index) =>
    storyboardSlot(270, index));
  assert.equal(timeline[0].startSeconds, 0);
  assert.equal(timeline[11].endSeconds, 270);
  for (let i = 1; i < timeline.length; i++) {
    assert.equal(timeline[i].startSeconds, timeline[i - 1].endSeconds);
    assert.ok(timeline[i].endSeconds > timeline[i].startSeconds);
  }
});

test('uses recorded song duration instead of first-minute fixed timing', () => {
  assert.equal(storyboardDurationSeconds({ durationSeconds: 315 }, '[Verse]\nA line'), 315);
  assert.equal(storyboardSlot(315, 8).startSeconds, 210);
  assert.equal(storyboardSlot(315, 11).endSeconds, 315);
});

test('without recorded duration, falls back to full-song 150–360 seconds', () => {
  assert.equal(storyboardDurationSeconds({}, '[Verse]\nHello world'), 150);
  assert.equal(storyboardDurationSeconds({}, ('love and kindness '.repeat(800))), 360);
});

test('rejects duration beyond MP4 support instead of silently truncating', () => {
  assert.throws(() => storyboardDurationSeconds({ durationSeconds: 362 }, 'Some lyrics'), /360 seconds/);
  assert.throws(() => storyboardDurationSeconds({ durationSeconds: -2 }, 'Some lyrics'), /360 seconds/);
});

test('ignores hallucinated model times and normalizes all 12 scenes', () => {
  const proposed = { startSeconds: 0, endSeconds: 5, lyric: 'Sung lyric', scene: 'Bridge' };
  const result = normalizedStoryboardScene(proposed, 'A\nB', 240, 10);
  assert.equal(result.startSeconds, 200);
  assert.equal(result.endSeconds, 220);
  assert.equal(result.scene, 'Bridge');
  assert.equal(result.lyric, 'Sung lyric');
});

test('missing model content preserves progression across lyric sections', () => {
  const lines = Array.from({ length: 24 }, (_, i) => 'line-' + i).join('\n');
  const first = normalizedStoryboardScene(null, lines, 240, 0);
  const last = normalizedStoryboardScene({}, lines, 240, 11);
  assert.equal(first.startSeconds, 0);
  assert.equal(last.endSeconds, 240);
  assert.equal(first.lyric, 'line-0');
  assert.equal(last.lyric, 'line-22');
  assert.match(last.scene, /beat 12/);
  assert.equal(storyboardLyric(lines, 6), 'line-12');
});

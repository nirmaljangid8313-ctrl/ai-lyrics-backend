import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Groq from 'groq-sdk';
import { toFile } from 'groq-sdk/uploads';
import {
  STORYBOARD_SCENE_COUNT,
  storyboardDurationSeconds,
  storyboardSlot,
  storyboardLyric,
  normalizedStoryboardScene
} from './storyboardTimeline.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '3mb' }));

const dir = path.join(os.tmpdir(), 'ai-song-video-studio');
fs.mkdirSync(dir, { recursive: true });

const upload = multer({
  dest: dir,
  limits: { fileSize: 25 * 1024 * 1024 }
});

const TEXT_MODEL =
  process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b';

const WHISPER_MODEL =
  process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';

const groq = process.env.GROQ_API_KEY
  ? new Groq({
      apiKey: process.env.GROQ_API_KEY,
      timeout: 90000,
      maxRetries: 1
    })
  : null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Avoid repeating the provider's observed ~60s gateway timeouts for minutes.
const ACE_MAX_ATTEMPTS = 2;
const ACE_GATEWAY_RETRY_DELAY_MS = 15000;
const ACE_PROVIDER_COOLDOWN_MS = 3 * 60 * 1000;
let aceProviderBusyUntil = 0;
const clean = value => String(value ?? '').trim();
const array = value => Array.isArray(value) ? value : [];
const wrap = fn => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);

const past = value =>
  array(value).slice(-100).map(String).join(' | ');

function requireGroq() {
  if (!groq) {
    throw Object.assign(
      new Error('GROQ_API_KEY is not configured.'),
      { status: 503 }
    );
  }
}

function parseJson(raw) {
  const source = clean(raw)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    return JSON.parse(source);
  } catch {}

  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');

  if (first >= 0 && last > first) {
    return JSON.parse(source.slice(first, last + 1));
  }

  throw new Error('AI did not return a complete JSON object.');
}

async function chatText(system, user, temperature = 0.7) {
  requireGroq();

  const data = await groq.chat.completions.create({
    model: TEXT_MODEL,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });

  return clean(data.choices?.[0]?.message?.content);
}

async function chatJson(system, user, temperature = 0.5) {
  requireGroq();

  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await groq.chat.completions.create({
        model: TEXT_MODEL,
        temperature: attempt ? 0.2 : temperature,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: system +
              '\nReturn one valid complete JSON object only.'
          },
          {
            role: 'user',
            content: user +
              (attempt
                ? '\nKeep strings shorter and ensure complete JSON.'
                : '')
          }
        ]
      });

      if (
        response.choices?.[0]?.finish_reason === 'length'
      ) {
        throw new Error('Truncated AI output.');
      }

      const json = parseJson(
        response.choices?.[0]?.message?.content
      );

      if (
        !json ||
        Array.isArray(json) ||
        typeof json !== 'object'
      ) {
        throw new Error('AI response was not a JSON object.');
      }

      return json;
    } catch (error) {
      lastError = error;
      console.error(
        'Groq JSON attempt',
        attempt + 1,
        error.message
      );

      if (attempt < 2) {
        await sleep(1000 * (attempt + 1));
      }
    }
  }

  throw new Error(
    'Groq JSON generation failed: ' + lastError?.message
  );
}

function languageRule(language) {
  const rules = {
    Hindi: 'Write Hindi in Roman English letters only.',
    'Hindi (Roman)':
      'Write Hindi in Roman English letters only.',
    'Hindi (Devanagari)':
      'Write Hindi in Devanagari.',
    'Kannada (Roman)':
      'Write Kannada in Roman letters.',
    'Kannada (Native)':
      'Write Kannada script.',
    'Punjabi (Roman)':
      'Write Punjabi in Roman letters.',
    'Punjabi (Gurmukhi)':
      'Write Punjabi in Gurmukhi.',
    'Haryanvi (Roman)':
      'Write Haryanvi in Roman letters.',
    'Haryanvi (Devanagari)':
      'Write Haryanvi in Devanagari.'
  };

  return rules[language] ||
    `Use ${language || 'English'} language.`;
}

// =====================================================
// HEALTH
// =====================================================

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    app: 'AI Song + Music Video Studio',
    mode: 'free-tier first',
    textModel: TEXT_MODEL,
    transcriptionModel: WHISPER_MODEL
  });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'AI Song + Music Video Studio Backend',
    textModel: TEXT_MODEL,
    transcriptionModel: WHISPER_MODEL
  });
});

// =====================================================
// LYRICS GENERATION
// =====================================================

app.post('/generate-lyrics', wrap(async (req, res) => {
  const prompt = clean(req.body?.prompt);
  const language = clean(req.body?.language) || 'English';

  if (!prompt) {
    return res.status(400).json({
      error: 'Prompt required.'
    });
  }

  const lyrics = await chatText(
    'Professional original songwriter. Never copy existing copyrighted lyrics. Return only lyrics.',
    `Language: ${language}
${languageRule(language)}
Idea: ${prompt}
Write [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Final Chorus], [Outro].
Memorable hook, natural rhymes, emotional storytelling and singable lines.`,
    0.83
  );

  res.json({ lyrics });
}));

// =====================================================
// LYRICS EDITOR
// =====================================================

app.post('/improve-lyrics', wrap(async (req, res) => {
  const {
    language = 'English',
    selectedText = '',
    lyrics = '',
    instruction = 'Improve the selection'
  } = req.body || {};

  const improvedText = await chatText(
    'Professional song lyric editor. Return replacement text only. Preserve rhyme, grammar and context.',
    `Language: ${language}
${languageRule(language)}
Instruction: ${instruction}
Selection: ${selectedText}
Full lyrics: ${lyrics}`,
    0.7
  );

  res.json({ improvedText });
}));

// =====================================================
// FIFTEEN CONTEXTUAL WORD SUGGESTIONS
// =====================================================

app.post('/suggest-words', wrap(async (req, res) => {
  const word = clean(req.body?.word);
  const lyrics = clean(req.body?.lyrics);
  const language = req.body?.language || 'English';

  if (!word) {
    return res.status(400).json({
      error: 'Word required.'
    });
  }

  let suggestions = [];

  for (
    let attempt = 0;
    attempt < 3 && suggestions.length < 15;
    attempt++
  ) {
    const json = await chatJson(
      'Contextual song lyric editor. Return strict JSON.',
      `Language: ${language}
${languageRule(language)}
Word: ${word}
Lyrics: ${lyrics.slice(0, 12000)}
Avoid: ${suggestions.join(', ')}
Return {"suggestions":["..."]} with 15 distinct context-fitting replacement words, matching grammar, emotion, rhyme and singing flow.`,
      0.6
    );

    suggestions = [
      ...new Set([
        ...suggestions,
        ...array(json.suggestions)
          .map(clean)
          .filter(Boolean)
      ])
    ].slice(0, 15);
  }

  res.json({ suggestions });
}));

// =====================================================
// AI CREATIVE COACH
// =====================================================

app.post('/ai-coach', wrap(async (req, res) => {
  const input = req.body || {};

  const json = await chatJson(
    'Original creative music, songwriting, sound-editing and video-production coach. JSON only.',
    `Stage: ${input.stage || 'Studio'}
Context: ${clean(input.context).slice(0, 10500)}
Page: ${Number(input.page || 0) + 1}
Avoid: ${past(input.exclude)}
Return {"suggestions":[{"title":"...","action":"...","why":"..."}],"hasMore":true} with 12 concise, useful original suggestions.`,
    0.45
  );

  res.json({
    suggestions: array(json.suggestions),
    hasMore: json.hasMore !== false
  });
}));

// =====================================================
// MUSIC RECOMMENDATIONS
// =====================================================

const musicKeys = [
  'title',
  'score',
  'category',
  'why',
  'genre',
  'subgenre',
  'beatType',
  'bpm',
  'key',
  'scale',
  'chordFeel',
  'instrumentation',
  'bassStyle',
  'drumStyle',
  'arrangement',
  'productionStyle',
  'vocalFit',
  'energyPlan',
  'mood'
].join(',');

app.post('/music-recommendations', wrap(async (req, res) => {
  const input = req.body || {};
  const lyrics = clean(input.lyrics);

  if (!lyrics) {
    return res.status(400).json({
      error: 'Lyrics required.'
    });
  }

  const count = Math.min(
    24,
    Math.max(8, Number(input.count || 16))
  );

  let best = null;
  const suggestions = [];

  for (
    let batch = 0;
    batch < Math.ceil(count / 4);
    batch++
  ) {
    const needed = Math.min(
      4,
      count - suggestions.length
    );

    if (needed <= 0) break;

    const json = await chatJson(
      'Elite original commercial music producer. Return complete JSON only.',
      `Language: ${input.language || 'English'}
Lyrics: ${lyrics.slice(0, 10000)}
Page: ${Number(input.page || 0) + 1}
Batch: ${batch + 1}
Avoid: ${past(input.exclude)}
Already given: ${suggestions.map(s => s.title).join(', ')}
Return {"best":{...},"suggestions":[{...}],"hasMore":true} with exactly ${needed} distinct production directions.
Each object must include: ${musicKeys}.
instrumentation must be a JSON array.
Keep string values short. Give real values, no placeholders.`,
      0.48
    );

    if (!best && json.best) {
      best = json.best;
    }

    suggestions.push(...array(json.suggestions));
  }

  res.json({
    best: best || suggestions[0] || null,
    suggestions: suggestions.slice(0, count),
    hasMore: true
  });
}));

// =====================================================
// LYRICS FOR AI SINGING
// =====================================================

async function singingLyrics(lyrics, language) {
  const target = {
    Hindi: 'Devanagari Hindi',
    'Hindi (Roman)': 'Devanagari Hindi',
    'Kannada (Roman)': 'Kannada script',
    'Punjabi (Roman)': 'Gurmukhi Punjabi',
    'Haryanvi (Roman)': 'Devanagari Haryanvi'
  }[language];

  if (
    !target ||
    !/[A-Za-z]/.test(lyrics)
  ) {
    return lyrics;
  }

  try {
    return await chatText(
      `Transliterate song lyrics to ${target} for singing pronunciation. Preserve lyrics and section labels. Return text only.`,
      lyrics,
      0.15
    );
  } catch (error) {
    console.error(
      'Singing script conversion:',
      error.message
    );
    return lyrics;
  }
}

// =====================================================
// ACE MUSIC STREAM PARSER
// =====================================================

function ssePayload(line) {
  if (!line.trimStart().startsWith('data:')) {
    return null;
  }

  const raw = line.trim().slice(5).trim();

  if (!raw || raw === '[DONE]') {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function validAudioDataUrl(value) {
  return (
    typeof value === 'string' &&
    /^data:audio\/[^;,]+;base64,/i.test(value)
  );
}

function findAceAudioUrl(payload) {
  const choice = payload?.choices?.[0];

  const candidates = [
    choice?.delta?.audio?.[0]?.audio_url?.url,
    choice?.delta?.audio?.audio_url?.url,
    choice?.delta?.audio_url?.url,
    choice?.delta?.audio?.url,
    choice?.message?.audio?.[0]?.audio_url?.url,
    choice?.message?.audio?.audio_url?.url,
    choice?.message?.audio_url?.url,
    choice?.message?.audio?.url,
    payload?.audio?.[0]?.audio_url?.url,
    payload?.audio?.audio_url?.url,
    payload?.audio_url?.url,
    payload?.audio?.url
  ];

  return candidates.find(validAudioDataUrl) || '';
}

function parseAceJsonAudio(payload) {
  const audioUrl = findAceAudioUrl(payload);

  if (!audioUrl) {
    return null;
  }

  const comma = audioUrl.indexOf(',');
  const metadata = audioUrl.slice(0, comma);
  const audioBase64 = audioUrl.slice(comma + 1);

  if (!audioBase64) {
    return null;
  }

  const mimeType =
    metadata.match(/^data:([^;]+);base64$/i)?.[1] ||
    'audio/mpeg';

  return {
    audioBase64,
    mimeType
  };
}

async function extractAceAudio(response) {
  if (!response.body) {
    throw new Error(
      'ACE Music returned an empty response stream.'
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let details = '';
  let audioUrl = '';
  let eventCount = 0;
  let lastEventType = '';
  let firstResponseText = '';
  let directJsonText = '';
  let directJsonMode = null;

  function processPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    eventCount++;

    const choice = payload?.choices?.[0];

    const content =
      choice?.delta?.content ??
      choice?.message?.content;

    if (
      typeof content === 'string' &&
      content !== '.'
    ) {
      details += content.slice(0, 10000);
      details = details.slice(-20000);
    }

    const foundUrl = findAceAudioUrl(payload);

    if (foundUrl) {
      audioUrl = foundUrl;
    }

    lastEventType = clean(
      payload.type ||
      payload.event ||
      choice?.finish_reason ||
      ''
    );
  }

  function processLine(line) {
    const payload = ssePayload(line);

    if (payload) {
      processPayload(payload);
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        const chunk = decoder.decode(value, {
          stream: !done
        });

        buffer += chunk;

        if (firstResponseText.length < 1200) {
          firstResponseText += chunk.slice(
            0,
            1200 - firstResponseText.length
          );
        }

        // Support a full JSON response if the provider ignores stream:true.
        // The firstResponseText field is only a short log preview.
        if (directJsonMode === null) {
          const firstChar = chunk.trimStart()[0];
          if (firstChar) directJsonMode = firstChar === '{';
        }
        if (directJsonMode) {
          directJsonText += chunk;
          if (directJsonText.length > 32 * 1024 * 1024) {
            throw new Error('ACE Music JSON response exceeded safe size.');
          }
        }
      }

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        processLine(line);
      }

      if (done) {
        if (buffer) {
          processLine(buffer);
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Handle non-streaming JSON responses when possible.
  if (!audioUrl && eventCount === 0) {
    try {
      const direct = JSON.parse(
        directJsonText.trim()
      );

      const result = parseAceJsonAudio(direct);

      if (result) {
        return {
          ...result,
          details
        };
      }
    } catch {}
  }

  if (!validAudioDataUrl(audioUrl)) {
    console.error('ACE audio extraction failed', {
      eventCount,
      lastEventType,
      firstResponsePreview: firstResponseText
        .replace(/data:audio\/[^,]+,[A-Za-z0-9+/=]+/gi, '[audio data omitted]')
        .slice(0, 350)
    });

    const error = new Error(
      `ACE Music returned HTTP 200 but no supported playable audio. Events received: ${eventCount}.`
    );
    error.status = 502;
    throw error;
  }

  const comma = audioUrl.indexOf(',');

  const audioBase64 = audioUrl.slice(
    comma + 1
  );

  const mimeType =
    audioUrl
      .slice(0, comma)
      .match(/^data:([^;]+);base64$/i)?.[1] ||
    'audio/mpeg';

  if (!audioBase64) {
    const error = new Error(
      'ACE Music returned an empty audio payload.'
    );
    error.status = 502;
    throw error;
  }

  console.log(
    'ACE Music audio extracted successfully.',
    'Base64 characters:',
    audioBase64.length
  );

  return {
    audioBase64,
    mimeType,
    details
  };
}

// =====================================================
// ACE MUSIC GENERATION
// =====================================================

app.post('/generate-music', wrap(async (req, res) => {
  const apiKey = process.env.ACEMUSIC_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: 'ACEMUSIC_API_KEY is not configured.'
    });
  }

  const cooldownSeconds = Math.ceil((aceProviderBusyUntil - Date.now()) / 1000);
  if (cooldownSeconds > 0) {
    return res.status(503).set('Retry-After', String(cooldownSeconds)).json({
      error: 'ACE Music provider is temporarily busy. Your existing music is safe; please retry later or use the free on-device instrumental backup.',
      providerStatus: 504,
      retryable: true,
      retryAfterSeconds: cooldownSeconds
    });
  }

  const input = req.body || {};
  const lyrics = clean(input.lyrics);
  const language = clean(input.language) || 'English';

  const instrumental = Boolean(input.instrumental);
  const alternate = Boolean(input.alternate);

  if (!lyrics && !instrumental) {
    return res.status(400).json({
      error: 'Lyrics required.'
    });
  }

  const generationLyrics = instrumental
    ? ''
    : await singingLyrics(lyrics, language);

  let prompt = clean(input.prompt) ||
    'Professionally arranged cinematic commercial music with polished instruments and mastering.';

  prompt +=
    '\nBuild a complete evolving intro, verses, pre-chorus, chorus, bridge and outro.' +
    '\nFollow lyrical meaning and energy.' +
    '\nAvoid repetitive loops.';

  if (alternate) {
    prompt +=
      '\nGenerate a distinct melodic and arrangement alternative.';
  }

  const vocalLanguage =
    language.startsWith('Hindi')
      ? 'hi'
      : language.startsWith('Punjabi')
        ? 'pa'
        : (
            language.startsWith('Kannada') ||
            language.startsWith('Haryanvi')
          )
          ? 'unknown'
          : 'en';

  const body = {
    model: 'acemusic/acestep-v1.5-turbo',
    messages: [
      {
        role: 'user',
        content:
          `<prompt>${prompt}</prompt>\n` +
          `<lyrics>${instrumental ? '[inst]' : generationLyrics}</lyrics>`
      }
    ],
    stream: true,
    thinking: false,
    temperature: alternate ? 1 : 0.85,
    top_p: 0.9,
    use_format: false,
    use_cot_caption: false,
    use_cot_language: false,
    audio_config: {
      instrumental,
      format: 'mp3',
      vocal_language: vocalLanguage
    }
  };

  const bpm = Number(input.bpm);
  const duration = Number(input.duration);

  if (
    Number.isFinite(bpm) &&
    bpm >= 30 &&
    bpm <= 300
  ) {
    body.audio_config.bpm = Math.round(bpm);
  }

  // The Android app sends its lyric-based target length in seconds.
  // Forward valid lengths instead of using the provider's default.
  if (Number.isFinite(duration) && duration >= 10 && duration <= 600) {
    body.audio_config.duration = Math.round(duration);
  }

  let response;
  let lastError;
  // One retry rather than three long gateway requests.
  for (let attempt = 1; attempt <= ACE_MAX_ATTEMPTS; attempt++) {
    try {
      console.log(
        'ACE Music request attempt',
        attempt,
        'duration:',
        body.audio_config.duration || 'provider default'
      );

      response = await fetch(
        'https://api.acemusic.ai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90000)
        }
      );

      console.log(
        'ACE Music attempt',
        attempt,
        'HTTP',
        response.status
      );

      if (
        response.ok ||
        // Avoid replaying timed-out or rate-limited music requests.
        ![502, 503, 504].includes(response.status) ||
        attempt === ACE_MAX_ATTEMPTS
      ) {
        break;
      }

      const retryStatus = response.status;
      await response.arrayBuffer().catch(() => {});
      response = undefined;
      if (retryStatus === 504) {
        console.log('ACE Music 504; waiting 15 seconds before final attempt.');
        await sleep(ACE_GATEWAY_RETRY_DELAY_MS);
        continue;
      }
    } catch (error) {
      lastError = error;
      response = undefined;

      console.error(
        'ACE Music connection attempt',
        attempt,
        error.message
      );

      if (attempt === ACE_MAX_ATTEMPTS) {
        break;
      }
    }

    await sleep(attempt * 5000);
  }

  if (!response) {
    return res.status(503).json({
      error:
        'ACE Music connection unavailable: ' +
        (lastError?.message || 'Please retry later.'),
      retryable: true
    });
  }

  if (!response.ok) {
    const providerStatus = response.status;

    if ([429, 502, 503, 504].includes(providerStatus)) {
      aceProviderBusyUntil = Date.now() + ACE_PROVIDER_COOLDOWN_MS;
      console.warn('ACE Music provider temporarily unavailable; cooldown started.');
    }

    const raw = await response.text().catch(() => '');

    let message = '';

    try {
      const json = JSON.parse(raw);

      message = clean(
        json?.error?.message ||
        json?.error
      );
    } catch {}

    // Do not pass HTML gateway pages back to the phone or flood logs.
    if (/^\s*</.test(raw) && [502, 503, 504].includes(providerStatus)) {
      message = 'ACE Music gateway is temporarily unavailable';
    }

    console.error(
      'ACE Music provider failure',
      providerStatus,
      message || raw.slice(0, 180).replace(/\s+/g, ' ')
    );

    return res
      .status(
        [429, 502, 503, 504].includes(providerStatus)
          ? 503
          : 502
      )
      .json({
        error:
          message ||
          `ACE Music returned HTTP ${providerStatus}.`,
        providerStatus,
        retryable: [429, 502, 503, 504].includes(providerStatus),
        retryAfterSeconds: [429, 502, 503, 504].includes(providerStatus)
          ? Math.ceil(ACE_PROVIDER_COOLDOWN_MS / 1000)
          : null
      });
  }

  console.log(
    'ACE Music accepted request. Reading audio stream.'
  );

  const audio = await extractAceAudio(response);
  aceProviderBusyUntil = 0;

  res.json({
    success: true,
    ...audio,
    lyricsUsed: generationLyrics,
    durationRequested:
      body.audio_config.duration || null
  });

  console.log(
    'ACE Music audio sent to Android successfully.'
  );
}));

// =====================================================
// UPLOADED SONG ANALYSIS
// =====================================================

app.post(
  '/analyze-song',
  upload.single('audio'),
  wrap(async (req, res) => {
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        error: 'Audio file required.'
      });
    }

    try {
      requireGroq();

      const transcription =
        await groq.audio.transcriptions.create({
          file: await toFile(fs.createReadStream(file.path), file.originalname || 'uploaded_audio.mp3'),
          model: WHISPER_MODEL,
          response_format: 'json'
        });

      const transcript = clean(transcription.text);

      if (!transcript) {
        throw new Error(
          'No speech could be transcribed.'
        );
      }

      const analysis = await chatJson(
        'Expert professional music-video song analyst. Return JSON.',
        `Analyze transcript: ${transcript.slice(0, 10000)}
Return {
"summary":"...",
"language":"...",
"mood":[],
"themes":[],
"genrePossibilities":[],
"vocalStyle":"...",
"energyCurve":"...",
"sections":[{"name":"...","description":"..."}],
"emotionalPeaks":[],
"visualKeywords":[],
"notes":"..."
}.
Do not invent exact musical key or BPM from transcript.`,
        0.3
      );

      res.json({
        transcript,
        analysis
      });
    } finally {
      await fs.promises
        .unlink(file.path)
        .catch(() => {});
    }
  })
);

// =====================================================
// VIDEO RECOMMENDATIONS
// =====================================================

const videoKeys = [
  'title',
  'score',
  'category',
  'why',
  'mode',
  'concept',
  'story',
  'visualStyle',
  'characters',
  'locations',
  'costumes',
  'colorPalette',
  'lighting',
  'cameraStyle',
  'choreography',
  'pacing',
  'transitions',
  'lipSyncStrategy',
  'beatSyncStrategy',
  'storyboardDirection'
].join(',');

function modeGuide(mode) {
  if (mode === 'FULL_ANIME') {
    return 'Original anime environments and consistent characters. No copyrighted characters.';
  }

  if (mode === 'ANIME_BOLLYWOOD_FUSION') {
    return 'Original anime characters with Bollywood fashion, emotion, choreography and scenery.';
  }

  return 'Original cinematic Bollywood music-video narrative with consistent characters.';
}

app.post('/video-recommendations', wrap(async (req, res) => {
  const input = req.body || {};
  const lyrics = clean(input.lyrics);

  if (!lyrics) {
    return res.status(400).json({
      error: 'Lyrics/transcript required.'
    });
  }

  const count = Math.min(
    4,
    Math.max(2, Number(input.count || 4))
  );

  const suggestions = [];
  let best = null;

  for (
    let batch = 0;
    batch < Math.ceil(count / 2);
    batch++
  ) {
    const needed = Math.min(
      2,
      count - suggestions.length
    );

    if (needed <= 0) break;

    const json = await chatJson(
      'Award-winning original Bollywood and anime music-video director. Return JSON only.',
      `Lyrics: ${lyrics.slice(0, 10000)}
Analysis: ${JSON.stringify(input.analysis || {}).slice(0, 3000)}
Music: ${JSON.stringify(input.music || {}).slice(0, 3000)}
Requested mode: ${input.videoMode || 'AUTO_AI_CHOICE'}
Page: ${Number(input.page || 0) + 1}
Batch: ${batch + 1}
Avoid: ${past(input.exclude)}
Already suggested: ${suggestions.map(s => s.title).join(', ')}
Return {"best":{...},"suggestions":[{...}],"hasMore":true}
with ${needed} distinct original video concepts.
Each object must include: ${videoKeys}.
locations is an array.
mode is CINEMATIC_BOLLYWOOD, FULL_ANIME or ANIME_BOLLYWOOD_FUSION.
Concise details, not placeholders.`,
      0.5
    );

    if (!best && json.best) {
      best = json.best;
    }

    suggestions.push(...array(json.suggestions));
  }

  // The AI occasionally returns fewer distinct alternatives than requested.
  // Complete the shortlist locally without spending further cloud credits.
  const chosenMode = ['FULL_ANIME', 'ANIME_BOLLYWOOD_FUSION', 'CINEMATIC_BOLLYWOOD']
    .includes(input.videoMode) ? input.videoMode : 'CINEMATIC_BOLLYWOOD';
  const finalBest = best || suggestions[0] || null;
  const unique = [];
  const usedTitles = new Set([clean(finalBest?.title).toLowerCase()].filter(Boolean));
  for (const option of suggestions) {
    const title = clean(option?.title).toLowerCase();
    if (title && !usedTitles.has(title)) {
      usedTitles.add(title);
      unique.push(option);
    }
  }
  const presets = [
    {
      title: 'Skyline Rooftop Performance',
      concept: 'An original rooftop performance growing from quiet dusk to luminous city skyline.',
      story: 'Solo opening; reflective verses; rooftop chorus; intimate closing shot.',
      locations: ['Original skyline rooftop', 'Stairwell'],
      colorPalette: 'Midnight blue and amber',
      lighting: 'Soft blue-hour glow',
      cameraStyle: 'Slow crane reveal and steady close-ups'
    },
    {
      title: 'Rainlit Street Journey',
      concept: 'A musical journey through rain-reflected neon streets and cinematic city scenery.',
      story: 'Walking introduction; unfolding street scenes; energized chorus; calm finale.',
      locations: ['Original rainlit avenue', 'Covered arcade'],
      colorPalette: 'Teal and violet',
      lighting: 'Reflected neon and soft rain',
      cameraStyle: 'Steadicam tracking and gentle orbit'
    },
    {
      title: 'Golden Hour Riverside Festival',
      concept: 'A hopeful riverside performance that expands into an original festival finale.',
      story: 'Gentle riverside opening; growing ensemble; festival chorus; sunset close.',
      locations: ['Original riverside promenade', 'Festival square'],
      colorPalette: 'Warm coral and gold',
      lighting: 'Golden-hour backlighting',
      cameraStyle: 'Wide establishing view into sweeping close-ups'
    }
  ];
  for (const preset of presets) {
    if (unique.length >= Math.min(count, 3)) break;
    if (usedTitles.has(preset.title.toLowerCase())) continue;
    unique.push({
      ...(finalBest || {}),
      ...preset,
      score: 0,
      category: 'Free built-in alternative',
      why: 'Distinct fallback concept; no additional AI request or paid credits.',
      mode: chosenMode,
      characters: 'Consistent original lead performer and optional supporting cast',
      costumes: 'Original coordinated outfits maintained across shots',
      choreography: 'Natural movements that grow with each chorus',
      pacing: 'Quiet intro, emotional build, strong chorus, gentle outro',
      transitions: 'Soft match cuts timed to musical phrases',
      lipSyncStrategy: 'Match facial movement to vocals where actual lip-sync is available',
      beatSyncStrategy: 'Align scene changes with downbeats and musical accents',
      storyboardDirection: preset.story
    });
    usedTitles.add(preset.title.toLowerCase());
  }
  res.json({
    best: finalBest || unique[0] || null,
    suggestions: unique.slice(0, count),
    hasMore: true
  });
}));

// =====================================================
// AI VIDEO PLAN EDITOR
// =====================================================

app.post('/edit-video-plan', wrap(async (req, res) => {
  const command = clean(req.body?.command);

  if (!command) {
    return res.status(400).json({
      error: 'Edit command required.'
    });
  }

  const input = req.body || {};

  const mode =
    clean(input.videoMode) ||
    'CINEMATIC_BOLLYWOOD';

  const updated = await chatJson(
    'AI video plan editor. Change only requested details, preserve all others. Return JSON only.',
    `Mode: ${mode}.
${modeGuide(mode)}
Command: ${command}
Current plan: ${JSON.stringify(input.current || {}).slice(0, 10000)}
Lyrics: ${clean(input.lyrics).slice(0, 8000)}
Return a complete updated plan with keys: ${videoKeys}.`,
    0.4
  );

  res.json({
    updated: updated.updated || updated
  });
}));

// =====================================================
// AI MUSIC VIDEO STORYBOARD
// =====================================================

app.post('/storyboard', wrap(async (req, res) => {
  const input = req.body || {};
  const lyrics = clean(input.lyrics);

  if (!lyrics) {
    return res.status(400).json({
      error: 'Lyrics/transcript required.'
    });
  }

  const mode =
    clean(input.videoMode) ||
    'CINEMATIC_BOLLYWOOD';

  const scenes = [];
  const durationSeconds = storyboardDurationSeconds(input, lyrics);

  for (let batch = 0; batch < 3; batch++) {
    const targets = Array.from({ length: 4 }, (_, local) => {
      const index = batch * 4 + local;
      return {
        ...storyboardSlot(durationSeconds, index, STORYBOARD_SCENE_COUNT),
        lyric: storyboardLyric(lyrics, index, STORYBOARD_SCENE_COUNT)
      };
    });
    const json = await chatJson(
      'Original music-video storyboard writer. Return JSON only.',
      `Mode: ${mode}.
${modeGuide(mode)}
Concept: ${JSON.stringify(input.concept || {}).slice(0, 4000)}
Entire song lyrics: ${lyrics.slice(0, 9500)}
Batch: ${batch + 1} of 3, spanning ${targets[0].startSeconds} to ${targets[3].endSeconds} seconds of a ${durationSeconds}-second song.
Relevant timed lyric anchors: ${JSON.stringify(targets)}
Return 4 sequential storyboard scenes as:
{"scenes":[{
"startSeconds":0,
"endSeconds":5,
"lyric":"...",
"meaning":"...",
"scene":"...",
"characters":"...",
"location":"...",
"action":"...",
"camera":"...",
"lighting":"...",
"emotion":"...",
"choreography":"...",
"transition":"...",
"prompt":"..."
}]}
Keep character continuity across all batches. Follow the exact four scene time windows and their respective lyric anchors above; do not restart at the beginning of the song.`,
      0.45
    );

    const suggestions = array(json.scenes);
    for (let local = 0; local < 4; local++) {
      scenes.push(normalizedStoryboardScene(
        suggestions[local], lyrics, durationSeconds,
        batch * 4 + local, STORYBOARD_SCENE_COUNT
      ));
    }
  }

  res.json({ scenes, durationSeconds });
}));

// =====================================================
// UNKNOWN ROUTES
// =====================================================

app.use((req, res) => {
  res.status(404).json({
    error:
      `Route not found: ${req.method} ${req.path}`
  });
});

// =====================================================
// CENTRAL ERROR HANDLING
// =====================================================

app.use((error, _req, res, _next) => {
  console.error('Backend error:', error);

  const status =
    error instanceof multer.MulterError
      ? 400
      : error.status || 500;

  if (!res.headersSent) {
    res.status(status).json({
      error:
        clean(error.message) ||
        'Server error'
    });
  }
});

// =====================================================
// START SERVER
// =====================================================

const port = Number(process.env.PORT || 3000);

app.listen(port, '0.0.0.0', () => {
  console.log(
    `AI Song + Music Video Studio backend listening on ${port}; text model ${TEXT_MODEL}`
  );
});

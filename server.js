import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Groq from 'groq-sdk';

const app = express();
app.use(cors());
app.use(express.json({ limit: '3mb' }));

const tempDir = path.join(os.tmpdir(), 'ai-song-video-studio');
fs.mkdirSync(tempDir, { recursive: true });

const upload = multer({
  dest: tempDir,
  limits: { fileSize: 25 * 1024 * 1024 }
});

const TEXT_MODEL =
  process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b';

const WHISPER_MODEL =
  process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';

const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

const asArray = x => Array.isArray(x) ? x : [];
const clean = x => String(x ?? '').trim();

const previousTitles = x =>
  asArray(x).slice(-120).map(String).join(' | ');

// ==================================================
// AI HELPERS
// ==================================================

function parseJsonLoose(text = '') {
  const source = clean(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    return JSON.parse(source);
  } catch {}

  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');

  if (start >= 0 && end > start) {
    return JSON.parse(source.slice(start, end + 1));
  }

  throw new Error('AI did not return valid JSON.');
}

async function chatText(
  system,
  user,
  temperature = 0.7
) {
  if (!groq) {
    throw new Error('GROQ_API_KEY is not configured.');
  }

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

async function chatJson(
  system,
  user,
  temperature = 0.6
) {
  if (!groq) {
    throw new Error('GROQ_API_KEY is not configured.');
  }

  const args = {
    model: TEXT_MODEL,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  };

  let result;

  try {
    result = await groq.chat.completions.create({
      ...args,
      response_format: { type: 'json_object' }
    });
  } catch (error) {
  console.error("Groq JSON mode failed:", error.message);
    result = await groq.chat.completions.create(args);
  }

  return parseJsonLoose(
    clean(result.choices?.[0]?.message?.content) || '{}'
  );
}

function languageRule(language) {
  const rules = {
    'Hindi (Roman)':
      'Write natural Hindi in Roman/English letters only. Never use Devanagari.',
    'Hindi (Devanagari)':
      'Write Hindi only in Devanagari.',
    'Kannada (Roman)':
      'Write natural Kannada in Roman/English letters only.',
    'Kannada (Native)':
      'Write Kannada script only.',
    'Punjabi (Roman)':
      'Write natural Punjabi in Roman/English letters only.',
    'Punjabi (Gurmukhi)':
      'Write Punjabi in Gurmukhi only.',
    'Haryanvi (Roman)':
      'Write natural Haryanvi in Roman/English letters only.',
    'Haryanvi (Devanagari)':
      'Write Haryanvi in Devanagari only.'
  };

  return rules[language] ||
    `Use ${language || 'English'} language.`;
}

function replyError(response, error) {
  console.error('Backend error:', error);

  if (!response.headersSent) {
    response.status(error.status || 500).json({
      error: clean(error?.message) || 'Server error'
    });
  }
}

const wrap = handler => (request, response, next) =>
  Promise.resolve(handler(request, response)).catch(next);

// ==================================================
// ROOT
// ==================================================

app.get('/', (_request, response) => {
  response.json({
    ok: true,
    app: 'AI Song + Music Video Studio',
    mode: 'free-tier first',
    textModel: TEXT_MODEL,
    transcriptionModel: WHISPER_MODEL
  });
});

// ==================================================
// GENERATE LYRICS
// ==================================================

app.post('/generate-lyrics', wrap(async (request, response) => {
  const { language = 'English' } = request.body || {};
  const prompt = clean(request.body?.prompt);

  if (!prompt) {
    return response.status(400).json({
      error: 'Prompt required.'
    });
  }

  const lyrics = await chatText(
    'You are an original professional songwriter. Do not copy copyrighted lyrics. Return only lyrics.',
    `Language: ${language}\n${languageRule(language)}\nSong idea: ${prompt}\n` +
    `Use [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge or Rap], [Final Chorus], [Outro]. ` +
    'Create original lyrics with memorable hook, natural rhymes, strong emotion and singable lines.',
    0.88
  );

  response.json({ lyrics });
}));

// ==================================================
// IMPROVE LYRICS
// ==================================================

app.post('/improve-lyrics', wrap(async (request, response) => {
  const {
    language = 'English',
    selectedText = '',
    lyrics = '',
    instruction = 'Improve the selection'
  } = request.body || {};

  const improvedText = await chatText(
    'You are a professional lyric editor. Return only replacement text. Maintain original context, meaning, flow and singability.',
    `Language: ${language}\n${languageRule(language)}\nInstruction: ${instruction}\n` +
    `Selected passage: ${selectedText}\nFull lyrics: ${lyrics}`,
    0.75
  );

  response.json({ improvedText });
}));

// ==================================================
// CONTEXTUAL WORD SUGGESTIONS
// ==================================================

app.post('/suggest-words', wrap(async (request, response) => {
  const {
    language = 'English',
    lyrics = ''
  } = request.body || {};

  const word = clean(request.body?.word);

  if (!word) {
    return response.status(400).json({
      error: 'Word required.'
    });
  }

  let suggestions = [];

  for (
    let attempt = 0;
    attempt < 3 && suggestions.length < 15;
    attempt++
  ) {
    const result = await chatJson(
      'You are a professional songwriter and contextual word replacement specialist. Return only strict JSON.',
      `Language: ${language}\n${languageRule(language)}\nWord: ${word}\nLyrics: ${lyrics}\n` +
      `Already offered: ${suggestions.join(', ')}\n` +
      'Return JSON {"suggestions":[...]} with exactly 15 unique, context-aware alternatives, fitting grammar, meaning, rhyme, emotion and singing flow.',
      0.78
    );

    suggestions = [
      ...new Set([
        ...suggestions,
        ...asArray(result.suggestions)
          .map(clean)
          .filter(Boolean)
      ])
    ].slice(0, 15);
  }

  response.json({ suggestions });
}));

// ==================================================
// AI COACH
// ==================================================

app.post('/ai-coach', wrap(async (request, response) => {
  const {
    stage = 'Studio',
    context = '',
    page = 0,
    exclude = []
  } = request.body || {};

  const result = await chatJson(
    'You are a creative coach for lyrics, songwriting, music, vocals, mixing, mastering, anime and Bollywood music videos, editing, lip sync and export. Return strict JSON only.',
    `Current stage: ${stage}\nProject: ${clean(context).slice(0, 14000)}\n` +
    `Suggestion page: ${Number(page) + 1}\nAvoid: ${previousTitles(exclude)}\n` +
    'Give 12 detailed, new, specific suggestions as {"suggestions":[{"title":"...","action":"...","why":"..."}],"hasMore":true}.',
    0.64
  );

  response.json({
    suggestions: asArray(result.suggestions),
    hasMore: result.hasMore !== false
  });
}));

// ==================================================
// MUSIC RECOMMENDATIONS
// ==================================================

const musicShape = `{
  "title":"...",
  "score":0,
  "category":"...",
  "why":"...",
  "genre":"...",
  "subgenre":"...",
  "beatType":"...",
  "bpm":100,
  "key":"C",
  "scale":"Major",
  "chordFeel":"...",
  "instrumentation":["..."],
  "bassStyle":"...",
  "drumStyle":"...",
  "arrangement":"...",
  "productionStyle":"...",
  "vocalFit":"...",
  "energyPlan":"...",
  "mood":"..."
}`;

app.post('/music-recommendations', wrap(async (request, response) => {
  const {
    language = 'English',
    page = 0,
    exclude = []
  } = request.body || {};

  const lyrics = clean(request.body?.lyrics);

  const count = Math.min(
    24,
    Math.max(8, Number(request.body?.count || 16))
  );

  if (!lyrics) {
    return response.status(400).json({
      error: 'Lyrics required.'
    });
  }

  const result = await chatJson(
    'You are an elite Indian and global music producer. Give original, commercially polished advice without imitating copyrighted songs. Strict JSON only.',
    `Language: ${language}\nLyrics: ${lyrics}\nChoose one best production direction with complete genre, BPM, key, drums, bass, instrumentation, energy and arrangement. ` +
    `Provide ${count} distinct alternatives ranked by lyric fit. Page ${Number(page) + 1}. Avoid: ${previousTitles(exclude)}. ` +
    `Return {"best":${musicShape},"suggestions":[${musicShape}],"hasMore":true}`,
    0.7
  );

  response.json({
    best: result.best || null,
    suggestions: asArray(result.suggestions),
    hasMore: result.hasMore !== false
  });
}));

// ==================================================
// ROMAN LYRICS TO SINGING SCRIPT
// ==================================================

async function convertLyricsForSinging(lyrics, language) {
  const target = {
    'Hindi (Roman)': 'Devanagari Hindi',
    'Kannada (Roman)': 'Kannada script',
    'Punjabi (Roman)': 'Gurmukhi Punjabi',
    'Haryanvi (Roman)': 'Devanagari Haryanvi'
  }[language];

  if (!target || !/[A-Za-z]/.test(lyrics)) {
    return lyrics;
  }

  return chatText(
    `Convert Roman-script song lyrics to ${target} for natural singing pronunciation. Preserve section labels and return lyrics only.`,
    lyrics,
    0.2
  );
}

// ==================================================
// ACEMUSIC STREAM
// ==================================================

function getSsePayload(line) {
  if (!line.trimStart().startsWith('data:')) {
    return null;
  }

  const payload = line.trim().slice(5).trim();

  if (!payload || payload === '[DONE]') {
    return null;
  }

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

async function extractAceAudio(aceResponse) {
  if (!aceResponse.body) {
    throw new Error(
      'ACEMusic returned an empty streaming response.'
    );
  }

  const reader = aceResponse.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let content = '';
  let audioUrl = '';

  const processLine = line => {
    const chunk = getSsePayload(line);

    if (!chunk) {
      return;
    }

    const delta = chunk?.choices?.[0]?.delta;

    if (
      typeof delta?.content === 'string' &&
      delta.content !== '.'
    ) {
      content += delta.content;
    }

    const found = delta?.audio?.[0]?.audio_url?.url;

    if (found) {
      audioUrl = found;
    }
  };

  while (true) {
    const { done, value } = await reader.read();

    if (value) {
      buffer += decoder.decode(value, {
        stream: !done
      });
    }

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    lines.forEach(processLine);

    if (done) {
      if (buffer) {
        processLine(buffer);
      }
      break;
    }
  }

  const commaIndex = audioUrl.indexOf(',');

  if (
    !audioUrl.startsWith('data:') ||
    commaIndex === -1
  ) {
    throw new Error(
      'ACEMusic did not return playable audio.'
    );
  }

  const header = audioUrl.slice(0, commaIndex);

  const mimeType =
    header.match(/^data:([^;]+);base64$/)?.[1] ||
    'audio/mpeg';

  return {
    audioBase64: audioUrl.slice(commaIndex + 1),
    mimeType,
    details: content
  };
}

// ==================================================
// GENERATE MUSIC
// ==================================================

app.post('/generate-music', wrap(async (request, response) => {
  const apiKey = process.env.ACEMUSIC_API_KEY;

  if (!apiKey) {
    return response.status(500).json({
      error: 'ACEMUSIC_API_KEY is not configured.'
    });
  }

  const input = request.body || {};

  const lyrics = clean(input.lyrics);
  const language = clean(input.language) || 'English';

  const instrumental = Boolean(input.instrumental);
  const alternate = Boolean(input.alternate);

  if (!lyrics && !instrumental) {
    return response.status(400).json({
      error: 'Lyrics are required.'
    });
  }

  const generationLyrics = instrumental
    ? ''
    : await convertLyricsForSinging(lyrics, language);

  let finalPrompt = clean(input.prompt) ||
    'High-end cinematic commercial music with realistic instrumentation, musical dynamics, polished mixing and mastering.';

  finalPrompt +=
    '\nArrange a complete song with evolving intro, verse, pre-chorus, chorus, bridge and outro. Follow each lyrical section and its changing emotion. Avoid simple loops.';

  if (alternate) {
    finalPrompt +=
      '\nCreate a genuinely different melodic, rhythmic, instrumental and arrangement interpretation.';
  }

  const body = {
    model: 'acemusic/acestep-v1.5-turbo',
    messages: [
      {
        role: 'user',
        content:
          `<prompt>${finalPrompt}</prompt>\n` +
          `<lyrics>${instrumental ? '[inst]' : generationLyrics}</lyrics>`
      }
    ],
    stream: true,
    thinking: false,
    temperature: alternate ? 1.0 : 0.85,
    top_p: 0.9,
    use_format: false,
    use_cot_caption: false,
    use_cot_language: false,
    audio_config: {
      instrumental,
      vocal_language:
        language.startsWith('Hindi')
          ? 'hi'
          : language.startsWith('Punjabi')
            ? 'pa'
            : language.startsWith('Kannada') ||
              language.startsWith('Haryanvi')
              ? 'unknown'
              : 'en',
      format: 'mp3'
    }
  };

  const bpm = Number(input.bpm);
  const duration = Number(input.duration);

  if (bpm >= 30 && bpm <= 300) {
    body.audio_config.bpm = Math.round(bpm);
  }

  if (duration > 0) {
    body.audio_config.duration =
      Math.max(10, Math.min(300, Math.round(duration)));
  }

  let aceResponse;
  let lastFetchError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      aceResponse = await fetch(
        'https://api.acemusic.ai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(240000)
        }
      );

      if (aceResponse.ok) {
        break;
      }

      if (
        ![429, 502, 503, 504].includes(aceResponse.status) ||
        attempt === 3
      ) {
        break;
      }

      await aceResponse.arrayBuffer().catch(() => {});

    } catch (error) {
      lastFetchError = error;

      if (attempt === 3) {
        break;
      }
    }

    await sleep(attempt * 8000);
  }

  if (!aceResponse) {
    throw lastFetchError ||
      new Error('Unable to connect to ACEMusic.');
  }

  if (!aceResponse.ok) {
    const providerStatus = aceResponse.status;

    const raw =
      await aceResponse.text().catch(() => '');

    let providerMessage = '';

    try {
      const parsed = JSON.parse(raw);

      providerMessage = clean(
        parsed?.error?.message ||
        parsed?.error
      );
    } catch {}

    return response.status(
      [429, 502, 503].includes(providerStatus)
        ? 503
        : providerStatus === 504
          ? 504
          : 502
    ).json({
      error:
        providerMessage ||
        `ACEMusic returned HTTP ${providerStatus}.`,
      providerStatus
    });
  }

  const audio = await extractAceAudio(aceResponse);

  response.json({
    success: true,
    ...audio,
    lyricsUsed: generationLyrics,
    durationRequested:
      body.audio_config.duration || null
  });
}));

// ==================================================
// ANALYZE SONG
// ==================================================

app.post(
  '/analyze-song',
  upload.single('audio'),
  wrap(async (request, response) => {
    const file = request.file;

    if (!file) {
      return response.status(400).json({
        error: 'Audio file required.'
      });
    }

    try {
      if (!groq) {
        throw new Error(
          'GROQ_API_KEY is not configured.'
        );
      }

      const transcription =
        await groq.audio.transcriptions.create({
          file: fs.createReadStream(file.path),
          model: WHISPER_MODEL,
          response_format: 'json'
        });

      const transcript = clean(transcription.text);

      if (!transcript) {
        throw new Error(
          'No speech/lyrics could be transcribed.'
        );
      }

      const analysis = await chatJson(
        'You are an expert song analyst and music-video director. Return strict JSON only.',
        `Analyze transcript: ${transcript}\n` +
        'Return {"summary":"...","language":"...","mood":[],"themes":[],"genrePossibilities":[],"vocalStyle":"...","energyCurve":"...","sections":[{"name":"...","description":"..."}],"emotionalPeaks":[],"visualKeywords":[],"notes":"..."}. Do not invent exact BPM or key from transcript.',
        0.4
      );

      response.json({ transcript, analysis });

    } finally {
      await fs.promises.unlink(file.path).catch(() => {});
    }
  })
);

// ==================================================
// VIDEO DIRECTOR CONFIGURATION
// ==================================================

const videoShape = `{
  "title":"...",
  "score":0,
  "category":"...",
  "why":"...",
  "mode":"CINEMATIC_BOLLYWOOD|FULL_ANIME|ANIME_BOLLYWOOD_FUSION",
  "concept":"...",
  "story":"...",
  "visualStyle":"...",
  "characters":"...",
  "locations":["..."],
  "costumes":"...",
  "colorPalette":"...",
  "lighting":"...",
  "cameraStyle":"...",
  "choreography":"...",
  "pacing":"...",
  "transitions":"...",
  "lipSyncStrategy":"...",
  "beatSyncStrategy":"...",
  "storyboardDirection":"..."
}`;

const cinematicBollywoodGuide = `
Original cinematic Bollywood music videos:
romance, dance, wedding, celebration,
travel, rain scenes, dramatic narrative,
rich cinematography.
Preserve character continuity.
Never copy a specific movie.
`;

const animeGuide = `
Original anime music videos:
romance, fantasy, slice-of-life,
cyberpunk, anime stage performance,
emotional narratives.
No copyrighted characters.
Preserve original character face,
hair, eye design, outfit,
proportions and palette.
`;

const animeBollywoodGuide = `
Original anime character designs
with Indian fashion, weddings,
Bollywood choreography, cultural settings,
anime lighting and cinematic storytelling.
Preserve character identity.
`;

const modeGuide = mode =>
  mode === 'FULL_ANIME'
    ? animeGuide
    : mode === 'ANIME_BOLLYWOOD_FUSION'
      ? animeBollywoodGuide
      : cinematicBollywoodGuide;

// ==================================================
// VIDEO RECOMMENDATIONS
// ==================================================

app.post('/video-recommendations', wrap(async (request, response) => {
  const lyrics = clean(request.body?.lyrics);

  if (!lyrics) {
    return response.status(400).json({
      error: 'Lyrics/transcript required.'
    });
  }

  const input = request.body || {};

  const requestedMode =
    clean(input.videoMode) || 'AUTO_AI_CHOICE';

  const count = Math.min(
    24,
    Math.max(8, Number(input.count || 16))
  );

  const result = await chatJson(
    'You are an award-winning Bollywood and anime music-video director. Return strict JSON only. Create original concepts and characters.',
    `Lyrics: ${lyrics}\n` +
    `Song analysis: ${JSON.stringify(input.analysis || {})}\n` +
    `Music: ${JSON.stringify(input.music || {})}\n` +
    `Requested mode: ${requestedMode}.\n` +
    'When AUTO_AI_CHOICE choose among CINEMATIC_BOLLYWOOD, FULL_ANIME, ANIME_BOLLYWOOD_FUSION.\n' +
    `Recommend one best concept and ${count} alternatives.\n` +
    `Page: ${Number(input.page || 0) + 1}.\n` +
    `Avoid: ${previousTitles(input.exclude)}\n` +
    `Return {"best":${videoShape},"suggestions":[${videoShape}],"hasMore":true}`,
    0.72
  );

  response.json({
    best: result.best || null,
    suggestions: asArray(result.suggestions),
    hasMore: result.hasMore !== false
  });
}));

// ==================================================
// EDIT VIDEO PLAN
// ==================================================

app.post('/edit-video-plan', wrap(async (request, response) => {
  const command = clean(request.body?.command);

  if (!command) {
    return response.status(400).json({
      error: 'Edit command required.'
    });
  }

  const input = request.body || {};

  const mode =
    clean(input.videoMode) ||
    'CINEMATIC_BOLLYWOOD';

  const updated = await chatJson(
    'You are an AI music-video editor. Apply ONLY requested changes. Preserve untouched details, character continuity, costumes and settings. Return strict JSON.',
    `Mode: ${mode}\n` +
    `${modeGuide(mode)}\n` +
    `Command: ${command}\n` +
    `Current plan: ${JSON.stringify(input.current || {})}\n` +
    `Lyrics: ${clean(input.lyrics).slice(0, 12000)}\n` +
    `Return one complete updated video plan matching ${videoShape}`,
    0.55
  );

  response.json({
    updated: updated.updated || updated
  });
}));

// ==================================================
// GENERATE STORYBOARD
// ==================================================

app.post('/storyboard', wrap(async (request, response) => {
  const lyrics = clean(request.body?.lyrics);

  if (!lyrics) {
    return response.status(400).json({
      error: 'Lyrics/transcript required.'
    });
  }

  const input = request.body || {};

  const mode =
    clean(input.videoMode) ||
    'CINEMATIC_BOLLYWOOD';

  const result = await chatJson(
    'You create original coherent music-video storyboards with character continuity, cinematic structure and scene transitions. Return strict JSON.',
    `Video mode: ${mode}\n` +
    `${modeGuide(mode)}\n` +
    `Concept: ${JSON.stringify(input.concept || {})}\n` +
    `Lyrics: ${lyrics}\n` +
    'Return {"scenes":[{"startSeconds":0,"endSeconds":5,"lyric":"...","meaning":"...","scene":"...","characters":"...","location":"...","action":"...","camera":"...","lighting":"...","emotion":"...","choreography":"...","transition":"...","prompt":"..."}]}. Include all major lyric/time segments.',
    0.62
  );

  response.json({
    scenes: asArray(result.scenes)
  });
}));

// ==================================================
// HEALTH CHECK
// ==================================================

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'AI Song + Music Video Studio Backend',
    freeFirst: true,
    textModel: TEXT_MODEL,
    transcriptionModel: WHISPER_MODEL
  });
});

// ==================================================
// UNKNOWN ROUTES
// ==================================================

app.use((request, response) => {
  response.status(404).json({
    error:
      `Route not found: ${request.method} ${request.path}`
  });
});

// ==================================================
// GLOBAL ERROR HANDLER
// ==================================================

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    return response.status(400).json({
      error: error.message
    });
  }

  replyError(response, error);
});

// ==================================================
// SERVER START
// ==================================================

const port = Number(
  process.env.PORT || 3000
);

app.listen(port, '0.0.0.0', () => {
  console.log(
    `AI Song + Music Video Studio backend running on port ${port}`
  );

  console.log(`Text model: ${TEXT_MODEL}`);
  console.log(`Transcription model: ${WHISPER_MODEL}`);

  console.log(
    'FREE-FIRST MODE: backend started successfully.'
  );
});

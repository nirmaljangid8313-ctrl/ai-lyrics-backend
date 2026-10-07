import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Groq from 'groq-sdk';

const app = express();

app.use(cors());

app.use(
  express.json({
    limit: '3mb'
  })
);

const tempDir =
  path.join(
    os.tmpdir(),
    'ai-song-video-studio'
  );

fs.mkdirSync(
  tempDir,
  {
    recursive: true
  }
);

const upload =
  multer({
    dest: tempDir,
    limits: {
      fileSize:
        25 *
        1024 *
        1024
    }
  });

if (
  !process.env
    .GROQ_API_KEY
) {
  console.warn(
    'WARNING: GROQ_API_KEY is missing.'
  );
}

const groq =
  new Groq({
    apiKey:
      process.env
        .GROQ_API_KEY
  });

const TEXT_MODEL =
  process.env
    .GROQ_TEXT_MODEL ||
  'openai/gpt-oss-120b';

const WHISPER_MODEL =
  process.env
    .GROQ_WHISPER_MODEL ||
  'whisper-large-v3-turbo';

function stripFence(
  text = ''
) {
  return text
    .trim()
    .replace(
      /^```(?:json)?\s*/i,
      ''
    )
    .replace(
      /\s*```$/i,
      ''
    )
    .trim();
}

function parseJsonLoose(
  text = ''
) {

  const clean =
    stripFence(text);

  try {
    return JSON.parse(
      clean
    );
  } catch {}

  const start =
    clean.indexOf(
      '{'
    );

  const end =
    clean.lastIndexOf(
      '}'
    );

  if (
    start >= 0 &&
    end > start
  ) {

    return JSON.parse(
      clean.slice(
        start,
        end + 1
      )
    );
  }

  throw new Error(
    'AI did not return valid JSON.'
  );
}

async function chatText(
  system,
  user,
  temperature = 0.7
) {

  const response =
    await groq
      .chat
      .completions
      .create({
        model:
          TEXT_MODEL,
        temperature,
        messages: [
          {
            role:
              'system',
            content:
              system
          },
          {
            role:
              'user',
            content:
              user
          }
        ]
      });

  return String(
    response
      .choices?.[0]
      ?.message
      ?.content ||
    ''
  ).trim();
}

async function chatJson(
  system,
  user,
  temperature = 0.6
) {

  const base = {
    model:
      TEXT_MODEL,
    temperature,
    messages: [
      {
        role:
          'system',
        content:
          system
      },
      {
        role:
          'user',
        content:
          user
      }
    ]
  };

  let response;

  try {

    response =
      await groq
        .chat
        .completions
        .create({
          ...base,
          response_format: {
            type:
              'json_object'
          }
        });

  } catch {

    response =
      await groq
        .chat
        .completions
        .create(base);
  }

  return parseJsonLoose(
    String(
      response
        .choices?.[0]
        ?.message
        ?.content ||
      '{}'
    )
  );
}

const asArray =
  value =>
    Array.isArray(
      value
    )
      ? value
      : [];

const previousTitles =
  value =>
    asArray(value)
      .slice(-120)
      .map(String)
      .join(' | ');

app.get(
  '/',
  (
    _request,
    response
  ) => {

    response.json({
      ok:
        true,
      app:
        'AI Song + Music Video Studio',
      mode:
        'zero-cost/free-tier only',
      textModel:
        TEXT_MODEL,
      transcriptionModel:
        WHISPER_MODEL
    });
  }
);

app.post(
  '/generate-lyrics',
  async (
    request,
    response
  ) => {

    try {

      const language =
        String(
          request.body
            .language ||
          'English'
        );

      const prompt =
        String(
          request.body
            .prompt ||
          ''
        ).trim();

      if (!prompt) {

        return response
          .status(400)
          .json({
            error:
              'Prompt required.'
          });
      }

      const romanHindi =
  language === 'Hindi (Roman)'
    ? 'Write Hindi-language lyrics only in natural Roman/English letters. Never use Devanagari script.'
    : language === 'Hindi (Devanagari)'
    ? 'Write Hindi-language lyrics only in natural Devanagari script.'
    : language === 'Kannada (Roman)'
    ? 'Write Kannada-language lyrics only in natural Roman/English transliteration. Never use Kannada script.'
    : language === 'Kannada (Native)'
    ? 'Write Kannada-language lyrics only in Kannada script.'
    : language === 'Punjabi (Roman)'
    ? 'Write Punjabi-language lyrics only in natural Roman/English transliteration. Never use Gurmukhi script.'
    : language === 'Punjabi (Gurmukhi)'
    ? 'Write Punjabi-language lyrics only in Gurmukhi script.'
    : language === 'Haryanvi (Roman)'
    ? 'Write Haryanvi-language lyrics only in natural Roman/English transliteration. Never use Devanagari script.'
    : language === 'Haryanvi (Devanagari)'
    ? 'Write Haryanvi-language lyrics only in Devanagari script.'
    : '';

      const lyrics =
        await chatText(
          `
You are an original professional songwriter.

Never copy existing songs or copyrighted lyrics.

Return only original lyrics.
          `,
          `
Language:
${language}

${romanHindi}

Song idea:
${prompt}

Use a strong song structure where suitable:

[Intro]
[Verse 1]
[Pre-Chorus]
[Chorus]
[Verse 2]
[Bridge or Rap]
[Final Chorus]
[Outro]

Requirements:

- Memorable hook
- Natural rhyme
- Smooth lyrical flow
- Strong emotion
- Singable line length
- Original wording
- Clear verse-to-chorus progression
          `,
          0.88
        );

      response.json({
        lyrics
      });

    } catch (error) {

      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

app.post(
  '/improve-lyrics',
  async (
    request,
    response
  ) => {

    try {

      const language =
        String(
          request.body
            .language ||
          'English'
        );

      const selectedText =
        String(
          request.body
            .selectedText ||
          ''
        );

      const lyrics =
        String(
          request.body
            .lyrics ||
          ''
        );

      const instruction =
        String(
          request.body
            .instruction ||
          'Improve the selection'
        );

      const romanHindi =
  language === 'Hindi (Roman)'
    ? 'Use natural Roman/English Hindi only. Never use Devanagari.'
    : language === 'Hindi (Devanagari)'
    ? 'Use natural Hindi in Devanagari script only.'
    : language === 'Kannada (Roman)'
    ? 'Use natural Kannada transliterated only in Roman/English letters. Never use Kannada script.'
    : language === 'Kannada (Native)'
    ? 'Use natural Kannada script only.'
    : language === 'Punjabi (Roman)'
    ? 'Use natural Punjabi transliterated only in Roman/English letters. Never use Gurmukhi.'
    : language === 'Punjabi (Gurmukhi)'
    ? 'Use natural Punjabi in Gurmukhi script only.'
    : language === 'Haryanvi (Roman)'
    ? 'Use natural Haryanvi transliterated only in Roman/English letters. Never use Devanagari.'
    : language === 'Haryanvi (Devanagari)'
    ? 'Use natural Haryanvi in Devanagari script only.'
    : '';

      const improvedText =
        await chatText(
          `
You are a professional lyric editor.

Return only replacement text.

Do not explain.

Keep the result original, singable,
context-aware and consistent with the song.
          `,
          `
Language:
${language}

${romanHindi}

Instruction:
${instruction}

Selected passage:
${selectedText}

Full lyrics:
${lyrics}
          `,
          0.75
        );

      response.json({
        improvedText
      });

    } catch (error) {

      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);
app.post(
  '/suggest-words',
  async (
    request,
    response
  ) => {

    try {

      const language =
        String(
          request.body
            .language ||
          'English'
        );

      const word =
        String(
          request.body
            .word ||
          ''
        ).trim();

      const lyrics =
        String(
          request.body
            .lyrics ||
          ''
        );

      if (!word) {

        return response
          .status(400)
          .json({
            error:
              'Word required.'
          });
      }

      const result =
        await chatJson(
          `
You are a songwriter and contextual word-replacement specialist.

Return strict JSON only.
          `,
          `
Language:
${language}

Selected word:
${word}

Full lyrics:
${lyrics}

Return exactly 15 unique replacement words
or very short replacement phrases.

Every option must fit:

- Grammar
- Meaning
- Rhyme
- Emotion
- Sentence context
- Song flow
- Selected language

Selected language option: ${language}. Follow its script exactly: Roman options must use Roman/English letters, and native-script options must use their selected native script.

Return:

{
  "suggestions": [
    "..."
  ]
}
          `,
          0.78
        );

      const suggestions =
        [
          ...new Set(
            asArray(
              result
                .suggestions
            )
              .map(String)
              .map(
                value =>
                  value.trim()
              )
              .filter(Boolean)
          )
        ].slice(
          0,
          15
        );

      response.json({
        suggestions
      });

    } catch (error) {

      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

app.post(
  '/ai-coach',
  async (
    request,
    response
  ) => {

    try {

      const stage =
        String(
          request.body
            .stage ||
          'Studio'
        );

      const context =
        String(
          request.body
            .context ||
          ''
        ).slice(
          0,
          14000
        );

      const page =
        Math.max(
          0,
          Number(
            request.body
              .page ||
            0
          )
        );

      const exclude =
        previousTitles(
          request.body
            .exclude
        );

      const result =
        await chatJson(
          `
You are the built-in creative coach for a complete AI song and music-video studio.

You help with:

- Lyrics
- Songwriting
- Music production
- Beats
- Arrangement
- Vocals
- Vocal editing
- Mixing
- Mastering
- Finished-song editing
- Bollywood video concepts
- Anime music videos
- Anime-Bollywood fusion
- Storyboarding
- Character consistency
- Cinematography
- Choreography
- Lip-sync planning
- Beat-sync planning
- Captions
- Video editing
- Export

Return strict JSON only.
          `,
          `
Current stage:
${stage}

Current project:
${context}

Suggestion page:
${page + 1}

Do not repeat:
${exclude || 'none'}

Give 12 NEW, highly specific,
directly usable suggestions.

Do not give generic advice.

If the current mode is anime,
make anime-specific suggestions.

If the current mode is Bollywood,
make cinematic Bollywood-specific suggestions.

Each suggestion must contain:

- Short title
- Directly usable action
- Why it improves this exact project

Return:

{
  "suggestions": [
    {
      "title": "...",
      "action": "...",
      "why": "..."
    }
  ],
  "hasMore": true
}
          `,
          0.64
        );

      response.json({
        suggestions:
          asArray(
            result
              .suggestions
          ),
        hasMore:
          result
            .hasMore !==
          false
      });

    } catch (error) {

      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

const musicShape =
`
{
  "title": "...",
  "score": 0,
  "category": "...",
  "why": "...",
  "genre": "...",
  "subgenre": "...",
  "beatType": "...",
  "bpm": 100,
  "key": "C",
  "scale": "Major",
  "chordFeel": "...",
  "instrumentation": ["..."],
  "bassStyle": "...",
  "drumStyle": "...",
  "arrangement": "...",
  "productionStyle": "...",
  "vocalFit": "...",
  "energyPlan": "...",
  "mood": "..."
}
`;

app.post(
  '/music-recommendations',
  async (
    request,
    response
  ) => {

    try {

      const lyrics =
        String(
          request.body
            .lyrics ||
          ''
        ).trim();

      const language =
        String(
          request.body
            .language ||
          'English'
        );

      const page =
        Math.max(
          0,
          Number(
            request.body
              .page ||
            0
          )
        );

      const count =
        Math.min(
          24,
          Math.max(
            8,
            Number(
              request.body
                .count ||
              16
            )
          )
        );

      if (!lyrics) {

        return response
          .status(400)
          .json({
            error:
              'Lyrics required.'
          });
      }

      const result =
        await chatJson(
          `
You are an elite Indian and global music producer,
composer, arranger and music director.

Return strict JSON only.

Do not imitate one specific copyrighted song,
recording or living artist.
          `,
          `
Language:
${language}

Full lyrics:
${lyrics}

STEP 1:

Choose ONE complete music direction that is
the strongest fit for these exact lyrics.

Choose:

- Genre
- Subgenre
- Beat/rhythm type
- BPM
- Key or tonal direction
- Scale
- Chord feeling
- Instrumentation
- Bass style
- Drum style
- Arrangement
- Production style
- Vocal treatment
- Verse energy
- Pre-chorus energy
- Chorus energy
- Bridge energy
- Overall mood

Explain WHY it is the best fit.

STEP 2:

Generate ${count}
meaningfully different alternatives.

Suggestion page:
${page + 1}

Previously shown:
${previousTitles(request.body.exclude) || 'none'}

Do not repeat previous concepts.

Explore relevant possibilities such as:

Bollywood
Hindi commercial pop
Punjabi
Haryanvi
Indian folk fusion
Sufi-inspired
Ghazal-inspired
Pop
Hip-hop
Trap
Drill
R&B
Soul
Rock
Pop rock
Lo-fi
EDM
House
Deep house
Afrobeat
Reggaeton
Acoustic
Orchestral
Cinematic
Synthwave
Retro
Wedding
Club
Ambient
Luxury hip-hop
Dark cinematic
Experimental fusion

Rank by actual lyric fit.

Recommendation object:

${musicShape}

Return:

{
  "best": ${musicShape},
  "suggestions": [
    ${musicShape}
  ],
  "hasMore": true
}
          `,
          0.70
        );

      response.json({
        best:
          result.best ||
          null,
        suggestions:
          asArray(
            result
              .suggestions
          ),
        hasMore:
          result
            .hasMore !==
          false
      });

    } catch (error) {

      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);
app.post('/generate-music', async (request, response) => {
  try {
    const apiKey = process.env.ACEMUSIC_API_KEY;

    if (!apiKey) {
      return response.status(500).json({
        error: 'ACEMUSIC_API_KEY is not configured.'
      });
    }

    const lyrics = String(request.body.lyrics || '').trim();
    const language = String(request.body.language || 'English').trim();
    const prompt = String(request.body.prompt || '').trim();
    const bpm = Number(request.body.bpm || 0);
    const duration = Number(request.body.duration || 0);
    const instrumental = Boolean(request.body.instrumental);
    const alternate = Boolean(request.body.alternate);

    if (!lyrics && !instrumental) {
      return response.status(400).json({
        error: 'Lyrics are required.'
      });
    }

    let generationLyrics = lyrics;

    if (
  [
    'Hindi (Roman)',
    'Kannada (Roman)',
    'Punjabi (Roman)',
    'Haryanvi (Roman)'
  ].includes(language) &&
  lyrics &&
  /[A-Za-z]/.test(lyrics)
) {
  const targetScript =
    language === 'Hindi (Roman)'
      ? 'natural Devanagari Hindi'
      : language === 'Kannada (Roman)'
      ? 'natural Kannada script'
      : language === 'Punjabi (Roman)'
      ? 'natural Gurmukhi Punjabi'
      : 'natural Devanagari Haryanvi';

  generationLyrics = await chatText(
    `Convert these Roman-script ${language.replace(' (Roman)', '')} song lyrics into ${targetScript} for accurate singing pronunciation. Preserve section labels such as [Intro], [Verse], [Chorus], [Bridge], [Rap Verse] and [Outro]. Return only the converted lyrics.`,
    lyrics,
    0.2
  );
}
      

    let finalPrompt =
      prompt ||
      'High-end cinematic commercial music, realistic instruments, evolving arrangement, strong verse and chorus contrast, professional mixing and mastering, wide stereo depth and release-ready production.';

    if (alternate) {
      finalPrompt +=
        ' Create a genuinely different melody, rhythm, arrangement, instrumentation and musical interpretation from the previous version.';
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
      thinking: true,
      temperature: alternate ? 1.0 : 0.85,
      top_p: 0.9,
      use_format: false,
      use_cot_caption: true,
      use_cot_language: true,
      audio_config: {
  instrumental: instrumental,
  vocal_language:
    language.startsWith('Hindi')
  ? 'hi'
  : language.startsWith('Punjabi')
  ? 'pa'
  : language.startsWith('Kannada')
  ? 'unknown'
  : language.startsWith('Haryanvi')
  ? 'unknown'
  : 'en',
  format: 'mp3'
}
    };

    if (bpm >= 30 && bpm <= 300) {
      body.audio_config.bpm = Math.round(bpm);
    }

    if (duration > 0) {
      body.audio_config.duration = Math.max(10, Math.min(600, duration));
    }

    let aceResponse;

for (let attempt = 1; attempt <= 3; attempt++) {
    aceResponse = await fetch(
        'https://api.acemusic.ai/v1/chat/completions',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        }
    );

    const shouldRetry =
        [502, 503, 504].includes(aceResponse.status) &&
        attempt < 3;

    if (!shouldRetry) {
        break;
    }

    await aceResponse.arrayBuffer().catch(() => {});

    console.log(
        `ACEMusic temporary error ${aceResponse.status}. Retry ${attempt}/2...`
    );

    await new Promise(resolve =>
        setTimeout(resolve, attempt * 5000)
    );
}

    if (!aceResponse.ok) {
  const raw = await aceResponse.text();

  let errorMessage =
    `ACEMusic returned HTTP ${aceResponse.status}: ${raw.slice(0, 250)}`;

  try {
    const errorData = JSON.parse(raw);
    errorMessage =
      errorData?.error?.message ||
      errorData?.error ||
      errorMessage;
  } catch (_) {}

  throw new Error(errorMessage);
}

if (!aceResponse.body) {
  throw new Error('ACEMusic returned an empty streaming response.');
}

const reader = aceResponse.body.getReader();
const decoder = new TextDecoder();

let buffer = '';
let audioUrl = null;
let content = '';

while (true) {
  const { done, value } = await reader.read();

  if (value) {
    buffer += decoder.decode(value, { stream: !done });
  }

  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed.startsWith('data: ')) continue;

    const payload = trimmed.slice(6).trim();

    if (!payload || payload === '[DONE]') continue;

    const chunk = JSON.parse(payload);
    const delta = chunk?.choices?.[0]?.delta;

    if (delta?.content && delta.content !== '.') {
      content += delta.content;
    }

    if (delta?.audio?.[0]?.audio_url?.url) {
      audioUrl = delta.audio[0].audio_url.url;
    }
  }

  if (done) break;
}

const message = {
  content
};

    if (!audioUrl || !audioUrl.includes(',')) {
      throw new Error('ACEMusic did not return playable audio.');
    }

    const commaIndex = audioUrl.indexOf(',');
    const header = audioUrl.substring(0, commaIndex);
    const audioBase64 = audioUrl.substring(commaIndex + 1);

    const mimeMatch = header.match(/^data:([^;]+);base64$/);
    const mimeType = mimeMatch?.[1] || 'audio/mpeg';

    response.json({
      success: true,
      audioBase64,
      mimeType,
      details: message?.content || '',
      lyricsUsed: generationLyrics
    });

  } catch (error) {
    console.error('ACEMusic generation error:', error);

    response.status(500).json({
      error: error.message || 'Music generation failed.'
    });
  }
});

app.post(
  '/analyze-song',
  upload.single(
    'audio'
  ),
  async (
    request,
    response
  ) => {

    const file =
      request.file;

    try {

      if (!file) {

        return response
          .status(400)
          .json({
            error:
              'Audio file required.'
          });
      }

      const transcription =
        await groq
          .audio
          .transcriptions
          .create({
            file:
              fs.createReadStream(
                file.path
              ),
            model:
              WHISPER_MODEL,
            response_format:
              'json'
          });

      const transcript =
        String(
          transcription
            .text ||
          ''
        ).trim();

      if (!transcript) {

        throw new Error(
          'No speech/lyrics could be transcribed.'
        );
      }

      const analysis =
        await chatJson(
          `
You are a professional song analyst,
music producer, lyric interpreter
and music-video director.

Return strict JSON only.
          `,
          `
Analyze this uploaded song transcript:

${transcript}

Analyze:

- Meaning
- Story
- Language
- Mood
- Themes
- Possible genre directions
- Vocal character
- Energy curve
- Likely verse/chorus/bridge sections
- Emotional peaks
- Strong visual possibilities
- Best clues for a cinematic or anime video

Important:

Do NOT invent an exact BPM,
musical key or scale from transcript alone.

Return:

{
  "summary": "...",
  "language": "...",
  "mood": ["..."],
  "themes": ["..."],
  "genrePossibilities": ["..."],
  "vocalStyle": "...",
  "energyCurve": "...",
  "sections": [
    {
      "name": "...",
      "description": "..."
    }
  ],
  "emotionalPeaks": ["..."],
  "visualKeywords": ["..."],
  "notes": "..."
}
          `,
          0.40
        );

      response.json({
        transcript,
        analysis
      });

    } catch (error) {

      response
        .status(500)
        .json({
          error:
            error.message
        });

    } finally {

      if (
        file?.path
      ) {

        fs.promises
          .unlink(
            file.path
          )
          .catch(
            () => {}
          );
      }
    }
  }
);

const videoShape =
`
{
  "title": "...",
  "score": 0,
  "category": "...",
  "why": "...",
  "mode": "CINEMATIC_BOLLYWOOD|FULL_ANIME|ANIME_BOLLYWOOD_FUSION",
  "concept": "...",
  "story": "...",
  "visualStyle": "...",
  "characters": "...",
  "locations": ["..."],
  "costumes": "...",
  "colorPalette": "...",
  "lighting": "...",
  "cameraStyle": "...",
  "choreography": "...",
  "pacing": "...",
  "transitions": "...",
  "lipSyncStrategy": "...",
  "beatSyncStrategy": "...",
  "storyboardDirection": "..."
}
`;

app.post(
  '/video-recommendations',
  async (
    request,
    response
  ) => {

    try {

      const lyrics =
        String(
          request.body
            .lyrics ||
          ''
        ).trim();

      const requestedMode =
        String(
          request.body
            .videoMode ||
          'AUTO_AI_CHOICE'
        );

      const page =
        Math.max(
          0,
          Number(
            request.body
              .page ||
            0
          )
        );

      const count =
        Math.min(
          24,
          Math.max(
            8,
            Number(
              request.body
                .count ||
              16
            )
          )
        );

      if (!lyrics) {

        return response
          .status(400)
          .json({
            error:
              'Lyrics/transcript required.'
          });
      }

      const modeInstruction =
        requestedMode ===
        'AUTO_AI_CHOICE'
          ? `
Choose the strongest mode between:

CINEMATIC_BOLLYWOOD
FULL_ANIME
ANIME_BOLLYWOOD_FUSION

based entirely on the song.
`
          : `
All recommendations must primarily follow:

${requestedMode}
`;

      const result =
        await chatJson(
          `
You are simultaneously:

- A Bollywood music-video director
- An anime music-video director
- A storyboard artist
- A cinematographer
- A choreographer
- A video editor
- A character-continuity director

Return strict JSON only.

Create original concepts.

Never copy a specific movie,
anime franchise,
existing music video,
or copyrighted character design.
          `,
          `
Lyrics/transcript:

${lyrics}

Song analysis:

${JSON.stringify(
  request.body
    .analysis ||
  {}
)}

Music information:

${JSON.stringify(
  request.body
    .music ||
  {}
)}

Requested visual mode:

${requestedMode}

${modeInstruction}

STEP 1:

Create ONE strongest overall
video recommendation.

Automatically select:

- Main concept
- Story
- Hero
- Heroine
- Supporting characters
- Locations
- Costumes
- Visual style
- Lighting
- Color palette
- Camera style
- Dance/choreography
- Scene pacing
- Transitions
- Lip-sync strategy
- Beat-sync strategy
- Storyboard direction

Explain why this is the strongest choice.

STEP 2:

Generate ${count}
additional distinct alternatives.

Suggestion page:
${page + 1}

Do not repeat:

${previousTitles(request.body.exclude) || 'none'}
          `,
          0.72
        );

      response.json({
        best:
          result.best ||
          null,
        suggestions:
          asArray(
            result
              .suggestions
          ),
        hasMore:
          result
            .hasMore !==
          false
      });

    } catch (error) {

      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);
/*
 * Additional video-mode guidance.
 * These concepts are used by the AI prompt
 * through the video recommendation endpoint.
 */

const cinematicBollywoodGuide =
`
For CINEMATIC_BOLLYWOOD explore only when suitable:

- Bollywood romance
- Rain romance
- Mountain romance
- Luxury lifestyle
- Wedding
- Celebration
- Club
- Dance performance
- Emotional separation
- Reunion
- Traditional Indian
- Urban cinematic
- Retro Bollywood-inspired original visuals
- Dream sequence
- Performance video
- Story-led narrative
- Travel romance

Use original characters and original story ideas.
`;

const animeGuide =
`
For FULL_ANIME explore only when suitable:

- Original anime hero and heroine
- Anime romance
- Emotional anime drama
- Slice-of-life
- Fantasy
- Cyberpunk
- Anime city nights
- Rain scenes
- Mountain anime
- School/college environments
- Anime performance stage
- Anime dance
- Anime action
- Dream worlds
- Anime watercolor
- Anime cel-shading
- Manga-inspired transitions

Never copy a known anime character.

Always describe an original character design.

Maintain:

- Face shape
- Eye design
- Eye color
- Hair style
- Hair color
- Body proportions
- Main outfit
- Main color palette

across scenes unless a costume change is intentional.
`;

const animeBollywoodGuide =
`
For ANIME_BOLLYWOOD_FUSION combine:

- Original anime character design
- Indian/Bollywood storytelling
- Indian emotional storytelling
- Indian fashion
- Saree
- Lehenga
- Sherwani
- Modern Indian street fashion
- Bollywood dance
- Indian wedding sequences
- Mumbai
- Delhi
- Jaipur
- Goa
- Himalayan/mountain settings
- Indian festivals where relevant
- Anime cinematography
- Anime lighting
- Anime expressions
- Original choreography

Maintain character identity across all scenes.
`;

app.post(
  '/edit-video-plan',
  async (
    request,
    response
  ) => {

    try {

      const command =
        String(
          request.body
            .command ||
          ''
        ).trim();

      const current =
        request.body
          .current ||
        {};

      const lyrics =
        String(
          request.body
            .lyrics ||
          ''
        ).slice(
          0,
          12000
        );

      const mode =
        String(
          request.body
            .videoMode ||
          'CINEMATIC_BOLLYWOOD'
        );

      if (!command) {

        return response
          .status(400)
          .json({
            error:
              'Edit command required.'
          });
      }

      const modeGuide =
        mode ===
        'FULL_ANIME'
          ? animeGuide
          : mode ===
            'ANIME_BOLLYWOOD_FUSION'
            ? animeBollywoodGuide
            : cinematicBollywoodGuide;

      const updated =
        await chatJson(
          `
You are an AI music-video editor.

Apply ONLY the user's requested change.

Preserve everything the user did not ask to change.

Preserve:

- Character identity
- Story continuity
- Visual style
- Costumes
- Locations
- Camera choices
- Scene continuity

For anime characters preserve:

- Face shape
- Eye design
- Eye color
- Hair
- Body design
- Character proportions
- Main palette

unless the user explicitly requests a change.

Return strict JSON only.
          `,
          `
Video mode:
${mode}

Mode guidance:
${modeGuide}

User edit command:

${command}

Current video plan:

${JSON.stringify(current)}

Lyrics/transcript:

${lyrics}

Return one updated video recommendation.

Use this exact object shape:

${videoShape}
          `,
          0.55
        );

      response.json({
        updated:
          updated.updated ||
          updated
      });

    } catch (error) {

      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

app.post(
  '/storyboard',
  async (
    request,
    response
  ) => {

    try {

      const lyrics =
        String(
          request.body
            .lyrics ||
          ''
        ).trim();

      const mode =
        String(
          request.body
            .videoMode ||
          'CINEMATIC_BOLLYWOOD'
        );

      const concept =
        request.body
          .concept ||
        {};

      if (!lyrics) {

        return response
          .status(400)
          .json({
            error:
              'Lyrics/transcript required.'
          });
      }

      const modeGuide =
        mode ===
        'FULL_ANIME'
          ? animeGuide
          : mode ===
            'ANIME_BOLLYWOOD_FUSION'
            ? animeBollywoodGuide
            : cinematicBollywoodGuide;

      const result =
        await chatJson(
          `
You are a professional music-video
storyboard director.

Return strict JSON only.

Create a coherent beginning,
middle and ending.

Every scene must connect naturally
to the previous scene.
          `,
          `
Video mode:
${mode}

Mode guidance:

${modeGuide}

Chosen concept:

${JSON.stringify(concept)}

Lyrics/transcript:

${lyrics}

Create a coherent scene-by-scene storyboard.

For anime modes:

Use original anime characters.

Preserve:

- Hair style
- Hair color
- Face shape
- Eye design
- Eye color
- Main outfit
- Character proportions
- Primary color palette

unless the story intentionally
changes clothing.

For Bollywood mode:

Preserve hero/heroine appearance,
costume logic,
location continuity
and cinematic continuity.

For every lyric/time segment include:

- Approximate start time
- Approximate end time
- Lyric
- Meaning
- Scene description
- Characters
- Location
- Action
- Camera angle/movement
- Lighting
- Emotion
- Dance/choreography/action
- Transition
- Final generation prompt

Return:

{
  "scenes": [
    {
      "startSeconds": 0,
      "endSeconds": 5,
      "lyric": "...",
      "meaning": "...",
      "scene": "...",
      "characters": "...",
      "location": "...",
      "action": "...",
      "camera": "...",
      "lighting": "...",
      "emotion": "...",
      "choreography": "...",
      "transition": "...",
      "prompt": "..."
    }
  ]
}
          `,
          0.62
        );

      response.json({
        scenes:
          asArray(
            result.scenes
          )
      });

    } catch (error) {

      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);
/*
 * Optional health/status route.
 */
app.get(
  '/health',
  (
    _request,
    response
  ) => {

    response.json({
      ok: true,
      service:
        'AI Song + Music Video Studio Backend',
      freeFirst:
        true,
      textModel:
        TEXT_MODEL,
      transcriptionModel:
        WHISPER_MODEL
    });
  }
);

/*
 * Unknown route handler.
 */
app.use(
  (
    request,
    response
  ) => {

    response
      .status(404)
      .json({
        error:
          `Route not found: ${request.method} ${request.path}`
      });
  }
);

/*
 * Global error handler.
 */
app.use(
  (
    error,
    _request,
    response,
    _next
  ) => {

    console.error(
      error
    );

    response
      .status(500)
      .json({
        error:
          error?.message ||
          'Server error'
      });
  }
);

const port =
  Number(
    process.env.PORT ||
    3000
  );

app.listen(
  port,
  '0.0.0.0',
  () => {

    console.log(
      `AI Song + Music Video Studio backend running on port ${port}`
    );

    console.log(
      `Text model: ${TEXT_MODEL}`
    );

    console.log(
      `Transcription model: ${WHISPER_MODEL}`
    );

    console.log(
      'FREE-FIRST MODE: no paid provider is required by this backend.'
    );
  }
);

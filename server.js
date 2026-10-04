const express = require("express");
const cors = require("cors");

require("dotenv").config();
const OpenAI = require("openai");
const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1"
});

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("AI Lyrics Maker backend is running!");
});

app.post("/generate-lyrics", async (req, res) => {
    const { language, prompt } = req.body;

    try {
const response = await openai.chat.completions.create({
model: "openai/gpt-oss-120b",
messages: [
    {
        role: "user",
        content: `Write original song lyrics in ${language} about this idea: ${prompt}. If the language is Hindi, write the Hindi lyrics only in Roman/English letters, not Devanagari script. Example: "Pehli dhadkan, pehla pyaar". Include Verse 1, Chorus, Verse 2, Bridge, and Final Chorus.`
    }
]
});
const lyrics = response.choices[0].message.content;

    res.json({ lyrics });
} catch (error) {
console.error(error);
res.status(500).json({ error: "Failed to generate lyrics" });
}
});
app.post("/suggest-words", async (req, res) => {
    const { word, lyrics, language } = req.body;

    if (!word || !lyrics) {
        return res.status(400).json({
            error: "Word and lyrics are required."
        });
    }

    try {
        const response = await openai.chat.completions.create({
            model: "openai/gpt-oss-120b",
            messages: [
                {
                    role: "user",
                    content: `
You are an expert professional song lyric editor.

Language: ${language}
Word to replace: "${word}"

Full lyrics:
${lyrics}

TASK:
Generate exactly 15 natural replacement words or very short phrases for "${word}".

STEP 1 — FIND THE EXACT CONTEXT:
First locate the exact occurrence of "${word}" in the full lyrics.
Identify the complete lyric line containing it.
Understand what "${word}" means specifically in that line, its grammatical role, emotional purpose, and relationship with the surrounding words.

If "${word}" does not appear anywhere in the lyrics, return exactly:
WORD_NOT_FOUND

STEP 2 — TEST EVERY CANDIDATE:
For every candidate, mentally substitute it directly into the exact original line in place of "${word}".

Reject the candidate unless the complete resulting lyric line:
- sounds natural when spoken or sung
- is grammatically correct
- makes clear sense
- preserves the original meaning or emotional intention as closely as possible
- uses the same grammatical role as the original word
- fits naturally with the words immediately before and after it
- suits the song's mood
- has reasonable rhythm, syllable flow, and singability

CRITICAL QUALITY RULES:
Do NOT return words merely because they are synonyms, related words, or connected to the general theme of the song.
Do NOT return formal dictionary or literary vocabulary when a normal songwriter would naturally use a simpler word.
Do NOT return awkward translations.
Do NOT return a candidate just to reach 15 suggestions.
Prefer natural, commonly used lyrical language over rare, technical, overly formal, or unnatural vocabulary.
Each suggestion must work as a DIRECT replacement at the exact position of "${word}".

For Hindi:
- use natural conversational/song Hindi
- write only in Roman/English letters
- never use Devanagari
- prefer words commonly heard in modern Hindi songs
- avoid overly Sanskritized/formal words such as "apoorn", "asampurn", or "sunya" when natural alternatives exist

For Punjabi or Haryanvi written in Roman letters:
- keep the same Roman-script style
- use natural song/conversational vocabulary

FINAL SELF-CHECK:
Before returning each suggestion, read the original lyric line again with that suggestion inserted.
If the resulting line sounds strange, unnatural, grammatically wrong, overly formal, or substantially changes the intended meaning, reject it.

Return exactly 15 high-quality suggestions if 15 genuinely suitable replacements exist.
If fewer than 15 genuinely natural replacements exist, return only the genuinely suitable ones. Quality is more important than forcing 15 poor suggestions.

Return one suggestion per line.
Do not number the suggestions.
Do not use bullets.
Do not repeat suggestions.
Do not add explanations, headings, quotation marks, or any other text.
`
                }
            ]
        });

        const text = response.choices[0].message.content || "";

        if (text.trim() === "WORD_NOT_FOUND") {
    return res.json({
        suggestions: []
    });
}

const suggestions = text
    .split("\n")
    .map(item => item.trim())
    .filter(item => item.length > 0)
    .filter(item => item !== "WORD_NOT_FOUND")
    .slice(0, 15);

        res.json({ suggestions });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Failed to suggest words."
        });
    }
});
const PORT = 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});

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
You are an expert song lyric editor.

Language: ${language}
Word to replace: "${word}"

Full lyrics:
${lyrics}

Generate exactly 15 context-aware replacement words or very short phrases for "${word}".

IMPORTANT:
Each suggestion must be something that can naturally replace "${word}" at its existing location in the lyrics.

Before suggesting a replacement, understand the complete lyric sentence or line containing "${word}", as well as the surrounding lyrics.

Every suggestion must:
- fit naturally into the existing lyric sentence or line
- preserve the intended meaning where possible
- be grammatically correct in that exact position
- match the emotional mood and context of the song
- consider rhyme, rhythm, syllable flow, and singability
- match the selected language and the language/style actually used in the lyrics
- avoid random dictionary synonyms that do not fit the sentence
- avoid duplicate or nearly identical suggestions
- be concise enough to replace the original word naturally
- if the language is Hindi, use Hindi words written only in Roman/English letters, never Devanagari
- if Punjabi or Haryanvi is written in English letters, keep the same Roman-script style

Return exactly 15 suggestions.
Return one suggestion per line.
Do not number the suggestions.
Do not use bullets.
Do not add explanations, headings, quotation marks, or any other text.
`
                }
            ]
        });

        const text = response.choices[0].message.content || "";

        const suggestions = text
            .split("\n")
            .map(item => item.trim())
            .filter(item => item.length > 0)
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

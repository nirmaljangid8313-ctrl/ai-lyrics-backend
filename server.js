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
You are helping edit song lyrics.

Language: ${language}
Word to replace: "${word}"

Full lyrics:
${lyrics}

Suggest exactly 8 alternative words or very short phrases that could replace "${word}" in these lyrics.

The suggestions should:
- fit the meaning and context
- sound natural in a song
- consider rhyme and lyrical flow
- preserve the mood where possible
- use the same language/style as the lyrics
- if the language is Hindi, return Hindi words written in English letters
- if Punjabi or Haryanvi is written in English letters, keep that same Roman-script style

Return ONLY the 8 suggestions, one per line.
Do not number them.
Do not add explanations.
`
                }
            ]
        });

        const text = response.choices[0].message.content || "";

        const suggestions = text
            .split("\n")
            .map(item => item.trim())
            .filter(item => item.length > 0)
            .slice(0, 8);

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

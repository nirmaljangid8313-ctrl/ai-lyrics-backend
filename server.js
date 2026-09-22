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

const PORT = 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
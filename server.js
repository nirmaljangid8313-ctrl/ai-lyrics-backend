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
Generate high-quality replacement words or very short phrases for "${word}" that can be inserted directly into its exact position in the lyrics.

STEP 1 — LOCATE THE WORD:
Find the exact occurrence of "${word}" in the full lyrics and identify the complete lyric line containing it.

If "${word}" does not appear anywhere in the lyrics, return exactly:
WORD_NOT_FOUND

STEP 2 — UNDERSTAND THE ORIGINAL LINE:
Understand:
- the exact meaning of "${word}" in this line
- its grammatical role
- the words immediately before and after it
- the emotion of the line
- the rhythm and natural lyrical phrasing

STEP 3 — GENERATE CANDIDATES:
Create a broad internal pool of possible replacements.

Do not output this pool yet.

STEP 4 — BUILD AND TEST THE COMPLETE LINE:
For every candidate, internally create a complete TEST LINE by replacing only "${word}" with that candidate.

Every other word in the original lyric line must remain exactly unchanged.

Example process:
Original line: [exact original lyric line]
Candidate: [candidate]
Test line: [original line with only the target word replaced]

Now judge the COMPLETE TEST LINE, not the candidate by itself.

Reject the candidate immediately if:
- the complete test line sounds unnatural
- grammar becomes incorrect
- another word would need to be added, removed, changed, or rearranged
- the candidate does not connect naturally with the words immediately before and after it
- the candidate changes the grammatical structure
- the candidate substantially changes the intended meaning
- the candidate is only thematically related rather than directly interchangeable
- the resulting line sounds awkward when spoken or sung
- the candidate creates redundant wording or duplicated meaning with nearby words

STEP 5 — NATIVE SONGWRITER TEST:
For every surviving candidate, ask:

"Would a fluent native songwriter naturally write and sing the COMPLETE TEST LINE exactly this way, without changing any other word?"

Keep the candidate only if the answer is clearly YES.

For Hindi:
- use natural modern Hindi song/conversational vocabulary
- write Hindi only in Roman/English letters
- never use Devanagari
- avoid unnecessarily formal, Sanskritized, dictionary-like, or unnatural vocabulary
- reject constructions that duplicate nearby grammar, for example a "bina..." replacement immediately after an existing "bin"

For Punjabi or Haryanvi written in Roman letters:
- keep Roman script
- use natural conversational/song vocabulary

STEP 6 — RANK THE SURVIVORS:
Rank valid candidates by:
1. grammatical fit in the exact original line
2. naturalness to a fluent native speaker
3. preservation of the original meaning/emotion
4. lyrical flow and singability
5. rhyme and rhythm

Return the best 15 only if 15 candidates genuinely pass all tests.
If fewer than 15 candidates genuinely pass, return fewer than 15.
Never include a weak candidate merely to reach 15.

OUTPUT RULES:
Return ONLY the replacement word or very short phrase from each approved candidate.
Do NOT return the complete test lines.
Return one approved replacement per line.
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
app.post("/improve-lyrics", async (req, res) => {
const { selectedText, lyrics, language } = req.body;
try {

const response = await openai.chat.completions.create({
    model: "openai/gpt-oss-120b",
    messages: [
        { role: "system", content: "You are an expert professional songwriter and lyric editor. IMPORTANT: If the selected language is Hindi, write Hindi words ONLY using English/Roman letters. NEVER use Devanagari/Hindi script characters such as अ, आ, क, ठ, ह. Return only Roman-script Hindi." },
        { role: "user", content: `Improve ONLY the selected lyric text while preserving its original meaning, emotion, language, rhyme, rhythm, and song context. Return only the improved replacement text, with no explanation. Language: ${language}. Selected text: ${selectedText}. Full lyrics for context: ${lyrics}` }
        ],
    });
    const improvedText = response.choices[0].message.content.trim();
    res.json({ improvedText });
    } catch (error) {
  console.error("Improve lyrics error:", error);
  res.status(500).json({ error: "Failed to improve lyrics" });
}
});
const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});

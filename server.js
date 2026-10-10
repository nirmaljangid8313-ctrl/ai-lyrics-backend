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
app.use(express.json({limit:'3mb'}));
const dir = path.join(os.tmpdir(),'ai-song-video-studio');
fs.mkdirSync(dir,{recursive:true});
const upload = multer({dest:dir,limits:{fileSize:25*1024*1024}});
const TEXT_MODEL=process.env.GROQ_TEXT_MODEL||'openai/gpt-oss-120b';
const WHISPER_MODEL=process.env.GROQ_WHISPER_MODEL||'whisper-large-v3-turbo';
const groq=process.env.GROQ_API_KEY?new Groq({apiKey:process.env.GROQ_API_KEY,timeout:90000,maxRetries:1}):null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=x=>String(x??'').trim();
const array=x=>Array.isArray(x)?x:[];
const wrap=f=>(req,res,next)=>Promise.resolve(f(req,res)).catch(next);
const past=x=>array(x).slice(-100).map(String).join(' | ');
function requireGroq(){if(!groq)throw Object.assign(new Error('GROQ_API_KEY is not configured.'),{status:503});}
function parseJson(raw){
 const source=clean(raw).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'');
 try{return JSON.parse(source);}catch{}
 const a=source.indexOf('{'), b=source.lastIndexOf('}');
 if(a>=0&&b>a)return JSON.parse(source.slice(a,b+1));
 throw new Error('AI did not return a complete JSON object.');
}
async function chatText(system,user,temperature=0.7){
 requireGroq();
 const data=await groq.chat.completions.create({model:TEXT_MODEL,temperature,messages:[{role:'system',content:system},{role:'user',content:user}]});
 return clean(data.choices?.[0]?.message?.content);
}
async function chatJson(system,user,temperature=0.5){
 requireGroq();
 let last;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const r=await groq.chat.completions.create({
    model:TEXT_MODEL,temperature:attempt?0.2:temperature,
    response_format:{type:'json_object'},
    messages:[{role:'system',content:system+'\nReturn one valid complete JSON object only.'},{role:'user',content:user+(attempt?'\nKeep each string shorter. Ensure complete JSON.':'')}]
   });
   if(r.choices?.[0]?.finish_reason==='length')throw new Error('Truncated AI output');
   const json=parseJson(r.choices?.[0]?.message?.content);
   if(!json||Array.isArray(json)||typeof json!=='object')throw new Error('AI response was not a JSON object');
   return json;
  }catch(e){
   last=e;console.error('Groq JSON attempt',attempt+1,e.message);
   if(attempt<2)await sleep(1000*(attempt+1));
  }
 }
 throw new Error('Groq JSON generation failed: '+last?.message);
}
function languageRule(language){
 const rules={
  'Hindi':'Write Hindi in Roman English letters only.',
  'Hindi (Roman)':'Write Hindi in Roman English letters only.',
  'Hindi (Devanagari)':'Write Hindi in Devanagari.',
  'Kannada (Roman)':'Write Kannada in Roman letters.',
  'Kannada (Native)':'Write Kannada script.',
  'Punjabi (Roman)':'Write Punjabi in Roman letters.',
  'Punjabi (Gurmukhi)':'Write Punjabi in Gurmukhi.',
  'Haryanvi (Roman)':'Write Haryanvi in Roman letters.',
  'Haryanvi (Devanagari)':'Write Haryanvi in Devanagari.'
 };
 return rules[language]||`Use ${language||'English'} language.`;
}
app.get('/',(_req,res)=>res.json({ok:true,app:'AI Song + Music Video Studio',mode:'free-tier first',textModel:TEXT_MODEL,transcriptionModel:WHISPER_MODEL}));
app.get('/health',(_req,res)=>res.json({ok:true,service:'AI Song + Music Video Studio Backend',textModel:TEXT_MODEL,transcriptionModel:WHISPER_MODEL}));

app.post('/generate-lyrics',wrap(async(req,res)=>{
 const prompt=clean(req.body?.prompt),language=clean(req.body?.language)||'English';
 if(!prompt)return res.status(400).json({error:'Prompt required.'});
 const lyrics=await chatText('Professional original songwriter. Never copy existing copyrighted lyrics. Return only lyrics.',`Language: ${language}\n${languageRule(language)}\nIdea: ${prompt}\nWrite [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Final Chorus], [Outro]. Memorable hook, natural rhymes, emotional storytelling and singable lines.`,0.83);
 res.json({lyrics});
}));
app.post('/improve-lyrics',wrap(async(req,res)=>{
 const {language='English',selectedText='',lyrics='',instruction='Improve the selection'}=req.body||{};
 const improvedText=await chatText('Professional song lyric editor. Return replacement text only. Preserve rhyme, grammar and context.',`Language: ${language}\n${languageRule(language)}\nInstruction: ${instruction}\nSelection: ${selectedText}\nFull lyrics: ${lyrics}`,0.7);
 res.json({improvedText});
}));
app.post('/suggest-words',wrap(async(req,res)=>{
 const word=clean(req.body?.word),lyrics=clean(req.body?.lyrics),language=req.body?.language||'English';
 if(!word)return res.status(400).json({error:'Word required.'});
 let suggestions=[];
 for(let i=0;i<3&&suggestions.length<15;i++){
  const j=await chatJson('Contextual song lyric editor. Return strict JSON.',`Language: ${language}. ${languageRule(language)}\nWord: ${word}\nLyrics: ${lyrics.slice(0,12000)}\nAvoid: ${suggestions.join(', ')}\nReturn {"suggestions":["..."]} with 15 distinct context-fitting replacement words, matching grammar, emotion, rhyme and singing flow.`,0.6);
  suggestions=[...new Set([...suggestions,...array(j.suggestions).map(clean).filter(Boolean)])].slice(0,15);
 }
 res.json({suggestions});
}));
app.post('/ai-coach',wrap(async(req,res)=>{
 const input=req.body||{};
 const j=await chatJson('Original creative music, songwriting, sound-editing and video-production coach. JSON only.',`Stage: ${input.stage||'Studio'}\nContext: ${clean(input.context).slice(0,10500)}\nPage: ${Number(input.page||0)+1}\nAvoid: ${past(input.exclude)}\nReturn {"suggestions":[{"title":"...","action":"...","why":"..."}],"hasMore":true} with 12 concise, useful original suggestions.`,0.45);
 res.json({suggestions:array(j.suggestions),hasMore:j.hasMore!==false});
}));
const musicKeys='title,score,category,why,genre,subgenre,beatType,bpm,key,scale,chordFeel,instrumentation,bassStyle,drumStyle,arrangement,productionStyle,vocalFit,energyPlan,mood';
app.post('/music-recommendations',wrap(async(req,res)=>{
 const input=req.body||{},lyrics=clean(input.lyrics);
 if(!lyrics)return res.status(400).json({error:'Lyrics required.'});
 const count=Math.min(24,Math.max(8,Number(input.count||16)));
 let best=null;const suggestions=[];
 for(let batch=0;batch<Math.ceil(count/4);batch++){
  const needed=Math.min(4,count-suggestions.length);
  if(needed<=0)break;
  const j=await chatJson('Elite original commercial music producer. Return complete JSON only.',`Language: ${input.language||'English'}\nLyrics: ${lyrics.slice(0,10000)}\nPage: ${Number(input.page||0)+1}; batch: ${batch+1}. Avoid: ${past(input.exclude)}\nAlready given: ${suggestions.map(s=>s.title).join(', ')}\nReturn {"best":{...},"suggestions":[{...}],"hasMore":true} with exactly ${needed} distinct production directions. Each object must include: ${musicKeys}. instrumentation must be a JSON array. Keep string values short. Give real values, no placeholders.`,0.48);
  if(!best&&j.best)best=j.best;
  suggestions.push(...array(j.suggestions));
 }
 res.json({best:best||suggestions[0]||null,suggestions:suggestions.slice(0,count),hasMore:true});
}));
async function singingLyrics(lyrics,language){
 const target={
  'Hindi':'Devanagari Hindi','Hindi (Roman)':'Devanagari Hindi',
  'Kannada (Roman)':'Kannada script','Punjabi (Roman)':'Gurmukhi Punjabi',
  'Haryanvi (Roman)':'Devanagari Haryanvi'
 }[language];
 if(!target||!/[A-Za-z]/.test(lyrics))return lyrics;
 try{return await chatText(`Transliterate song lyrics to ${target} for singing pronunciation. Preserve lyrics and section labels. Return text only.`,lyrics,0.15);}
 catch(e){console.error('Singing script conversion:',e.message);return lyrics;}
}
function ssePayload(line){
 if(!line.trimStart().startsWith('data:'))return null;
 const raw=line.trim().slice(5).trim();
 if(!raw||raw==='[DONE]')return null;
 try{return JSON.parse(raw);}catch{return null;}
}
async function extractAceAudio(response){
 if(!response.body)throw new Error('ACE Music returned an empty stream.');
 const reader=response.body.getReader(),decoder=new TextDecoder();
 let buffer='',details='',audioUrl='';
 function lineEvent(line){
  const j=ssePayload(line);if(!j)return;
  const d=j?.choices?.[0]?.delta;
  if(typeof d?.content==='string'&&d.content!=='.')details+=d.content;
  const u=d?.audio?.[0]?.audio_url?.url;
  if(u)audioUrl=u;
 }
 try{
  while(true){
   const {done,value}=await reader.read();
   if(value)buffer+=decoder.decode(value,{stream:!done});
   const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';
   lines.forEach(lineEvent);
   if(done){if(buffer)lineEvent(buffer);break;}
  }
 }finally{reader.releaseLock();}
 const comma=audioUrl.indexOf(',');
 if(!audioUrl.startsWith('data:')||comma<0)throw new Error('ACE Music returned no playable audio.');
 const mimeType=audioUrl.slice(0,comma).match(/^data:([^;]+);base64$/)?.[1]||'audio/mpeg';
 return {audioBase64:audioUrl.slice(comma+1),mimeType,details};
}
app.post('/generate-music',wrap(async(req,res)=>{
 const apiKey=process.env.ACEMUSIC_API_KEY;
 if(!apiKey)return res.status(503).json({error:'ACEMUSIC_API_KEY is not configured.'});
 const input=req.body||{},lyrics=clean(input.lyrics),language=clean(input.language)||'English';
 const instrumental=Boolean(input.instrumental),alternate=Boolean(input.alternate);
 if(!lyrics&&!instrumental)return res.status(400).json({error:'Lyrics required.'});
 const generationLyrics=instrumental?'':await singingLyrics(lyrics,language);
 let prompt=clean(input.prompt)||'Professionally arranged cinematic commercial music with polished instruments and mastering.';
 prompt+='\nBuild a complete evolving intro, verses, pre-chorus, chorus, bridge and outro. Follow lyrical meaning and energy. Avoid repetitive loops.';
 if(alternate)prompt+='\nGenerate a distinct melodic and arrangement alternative.';
 const body={
  model:'acemusic/acestep-v1.5-turbo',
  messages:[{role:'user',content:`<prompt>${prompt}</prompt>\n<lyrics>${instrumental?'[inst]':generationLyrics}</lyrics>`}],
  stream:true,thinking:false,temperature:alternate?1:0.85,top_p:0.9,
  use_format:false,use_cot_caption:false,use_cot_language:false,
  audio_config:{
   instrumental,format:'mp3',
   vocal_language:language.startsWith('Hindi')?'hi':language.startsWith('Punjabi')?'pa':(language.startsWith('Kannada')||language.startsWith('Haryanvi'))?'unknown':'en'
  }
 };
 const bpm=Number(input.bpm),duration=Number(input.duration);
 if(bpm>=30&&bpm<=300)body.audio_config.bpm=Math.round(bpm);
 if(duration>0)body.audio_config.duration=Math.max(10,Math.min(300,Math.round(duration)));
 let response,lastError;
 for(let attempt=1;attempt<=3;attempt++){
  try{
   response=await fetch('https://api.acemusic.ai/v1/chat/completions',{
    method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(180000)
   });
   console.log('ACE Music attempt',attempt,'HTTP',response.status);
   if(response.ok||![429,502,503,504].includes(response.status)||attempt===3)break;
   await response.arrayBuffer().catch(()=>{});response=undefined;
  }catch(e){
   lastError=e;response=undefined;
   console.error('ACE Music connection attempt',attempt,e.message);
   if(attempt===3)break;
  }
  await sleep(attempt*5000);
 }
 if(!response)return res.status(503).json({error:'ACE Music connection unavailable: '+(lastError?.message||'please retry later'),retryable:true});
 if(!response.ok){
  const providerStatus=response.status,raw=await response.text().catch(()=>'');
  let message='';try{const j=JSON.parse(raw);message=clean(j?.error?.message||j?.error);}catch{}
  return res.status([429,502,503,504].includes(providerStatus)?503:502).json({
   error:message||`ACE Music returned HTTP ${providerStatus}.`,providerStatus,
   retryable:[429,502,503,504].includes(providerStatus)
  });
 }
 const audio=await extractAceAudio(response);
 res.json({success:true,...audio,lyricsUsed:generationLyrics,durationRequested:body.audio_config.duration||null});
}));
app.post('/analyze-song',upload.single('audio'),wrap(async(req,res)=>{
 const file=req.file;
 if(!file)return res.status(400).json({error:'Audio file required.'});
 try{
  requireGroq();
  const transcriptResult=await groq.audio.transcriptions.create({
   file:fs.createReadStream(file.path),model:WHISPER_MODEL,response_format:'json'
  });
  const transcript=clean(transcriptResult.text);
  if(!transcript)throw new Error('No speech could be transcribed.');
  const analysis=await chatJson('Expert professional music-video song analyst. Return JSON.',`Analyze transcript: ${transcript.slice(0,10000)}\nReturn {"summary":"...","language":"...","mood":[],"themes":[],"genrePossibilities":[],"vocalStyle":"...","energyCurve":"...","sections":[{"name":"...","description":"..."}],"emotionalPeaks":[],"visualKeywords":[],"notes":"..."}. Do not invent exact musical key or BPM from transcript.`,0.3);
  res.json({transcript,analysis});
 }finally{await fs.promises.unlink(file.path).catch(()=>{});}
}));
const videoKeys='title,score,category,why,mode,concept,story,visualStyle,characters,locations,costumes,colorPalette,lighting,cameraStyle,choreography,pacing,transitions,lipSyncStrategy,beatSyncStrategy,storyboardDirection';
function modeGuide(mode){
 return mode==='FULL_ANIME'?'Original anime environments and consistent characters. No copyrighted characters.':mode==='ANIME_BOLLYWOOD_FUSION'?'Original anime characters with Bollywood fashion, emotion, choreography and scenery.':'Original cinematic Bollywood music-video narrative with consistent characters.';
}
app.post('/video-recommendations',wrap(async(req,res)=>{
 const input=req.body||{},lyrics=clean(input.lyrics);
 if(!lyrics)return res.status(400).json({error:'Lyrics/transcript required.'});
 const count=Math.min(24,Math.max(8,Number(input.count||16)));
 const suggestions=[];let best=null;
 for(let batch=0;batch<Math.ceil(count/4);batch++){
  const needed=Math.min(4,count-suggestions.length);
  if(needed<=0)break;
  const j=await chatJson('Award-winning original Bollywood and anime music-video director. Return JSON only.',`Lyrics: ${lyrics.slice(0,10000)}\nAnalysis: ${JSON.stringify(input.analysis||{}).slice(0,3000)}\nMusic: ${JSON.stringify(input.music||{}).slice(0,3000)}\nRequested mode: ${input.videoMode||'AUTO_AI_CHOICE'}. Page ${Number(input.page||0)+1}, batch ${batch+1}.\nAvoid: ${past(input.exclude)}. Already suggested: ${suggestions.map(s=>s.title).join(', ')}\nReturn {"best":{...},"suggestions":[{...}],"hasMore":true} with ${needed} distinct original video concepts. Each object must include: ${videoKeys}. locations is an array; mode is CINEMATIC_BOLLYWOOD, FULL_ANIME or ANIME_BOLLYWOOD_FUSION. Concise details, not placeholders.`,0.5);
  if(!best&&j.best)best=j.best;
  suggestions.push(...array(j.suggestions));
 }
 res.json({best:best||suggestions[0]||null,suggestions:suggestions.slice(0,count),hasMore:true});
}));
app.post('/edit-video-plan',wrap(async(req,res)=>{
 const command=clean(req.body?.command);
 if(!command)return res.status(400).json({error:'Edit command required.'});
 const input=req.body||{},mode=clean(input.videoMode)||'CINEMATIC_BOLLYWOOD';
 const updated=await chatJson('AI video plan editor. Change only the requested details, preserve all others. Return JSON only.',`Mode: ${mode}. ${modeGuide(mode)}\nCommand: ${command}\nCurrent plan: ${JSON.stringify(input.current||{}).slice(0,10000)}\nLyrics: ${clean(input.lyrics).slice(0,8000)}\nReturn a complete updated plan with keys: ${videoKeys}.`,0.4);
 res.json({updated:updated.updated||updated});
}));
app.post('/storyboard',wrap(async(req,res)=>{
 const input=req.body||{},lyrics=clean(input.lyrics);
 if(!lyrics)return res.status(400).json({error:'Lyrics/transcript required.'});
 const mode=clean(input.videoMode)||'CINEMATIC_BOLLYWOOD';
 const scenes=[];
 for(let batch=0;batch<3;batch++){
  const j=await chatJson('Original music-video storyboard writer. Return JSON only.',`Mode: ${mode}. ${modeGuide(mode)}\nConcept: ${JSON.stringify(input.concept||{}).slice(0,4000)}\nLyrics: ${lyrics.slice(0,9500)}\nBatch: ${batch+1}. Return 4 sequential storyboard scenes as {"scenes":[{"startSeconds":0,"endSeconds":5,"lyric":"...","meaning":"...","scene":"...","characters":"...","location":"...","action":"...","camera":"...","lighting":"...","emotion":"...","choreography":"...","transition":"...","prompt":"..."}]}. Keep character continuity and scene times progressing, starting near ${batch*20} seconds.`,0.45);
  scenes.push(...array(j.scenes));
 }
 res.json({scenes});
}));
app.use((req,res)=>res.status(404).json({error:`Route not found: ${req.method} ${req.path}`}));
app.use((error,_req,res,_next)=>{
 console.error('Backend error:',error);
 if(!res.headersSent)res.status(error instanceof multer.MulterError?400:(error.status||500)).json({error:clean(error.message)||'Server error'});
});
const port=Number(process.env.PORT||3000);
app.listen(port,'0.0.0.0',()=>console.log(`AI Song + Music Video Studio backend listening on ${port}; text model ${TEXT_MODEL}`));

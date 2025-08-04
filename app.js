import { GoogleGenAI } from "https://esm.sh/@google/genai";

const $ = sel => document.querySelector(sel);
const log = msg => console.log(msg);

// ---------- utilities ----------
function parseRange(rangeStr, maxItems) {
  if (!rangeStr) return { start: 1, end: maxItems };
  const [s, e] = rangeStr.split('-');
  let start = parseInt(s, 10) || 1;
  let end   = parseInt(e, 10) || maxItems;
  if (start < 1) start = 1;
  if (end > maxItems) end = maxItems;
  if (start > end) [start, end] = [end, start];
  return { start, end };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------- translation layer ----------
const safetySettings = [
  {category:"HARM_CATEGORY_HARASSMENT", threshold:"BLOCK_NONE"},
  {category:"HARM_CATEGORY_HATE_SPEECH", threshold:"BLOCK_NONE"},
  {category:"HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold:"BLOCK_NONE"},
  {category:"HARM_CATEGORY_DANGEROUS_CONTENT", threshold:"BLOCK_NONE"},
  {category:"HARM_CATEGORY_CIVIC_INTEGRITY", threshold:"BLOCK_NONE"}
];

async function googleTranslate(chunk) {
  const params = new URLSearchParams({
    client:'gtx', sl:'zh-CN', tl:'en', dt:'t', q:chunk
  });
  const url = 'https://translate.googleapis.com/translate_a/single?' + params;
  const res = await fetch(url, {headers:{'User-Agent':'Mozilla/5.0'}});
  const data = await res.json();
  return data[0].map(x=>x[0]).join('');
}

async function translateContent(genAI, content, model) {
  try {
    const resp = await genAI.models.generateContent({
      model,
      contents: content,
      config: {
        systemInstruction: "You are a strict translator. Do not modify the story, characters, or intent. Preserve all names of people, but translate techniques/props/places/organizations when readability benefits. Prioritize natural English flow while keeping the original's tone (humor, sarcasm, etc.). For idioms or culturally specific terms, translate literally if possible; otherwise, adapt with a footnote. Dialogue must match the original's bluntness or subtlety, including punctuation.",
        safetySettings
      }
    });
    return { ok:true, text:resp.text, model };
  } catch (e) {
    log(`Gemini failed (${e.message}). Falling back to Google Translate…`);
    // Google fallback
    const sentences = content.split(/[.!?！？。]+/);
    const chunks = [];
    let buf = '';
    for (const s of sentences) {
      const next = buf + s;
      if (next.length > 1000 && buf) { chunks.push(buf); buf = s; }
      else buf = next;
    }
    if (buf.trim()) chunks.push(buf.trim());
    let result = '';
    for (const ch of chunks) result += await googleTranslate(ch);
    return { ok:true, text:result, model:'google translate' };
  }
}

// ---------- main ----------
$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  $('#progress').style.display = 'block';

  const jsonUrl   = $('#jsonUrl').value.trim();
  const range     = $('#range').value.trim();
  const apiKey    = $('#apiKey').value.trim();
  const model     = $('#model').value;
  const titleModel= $('#titleModel').value;
  const delay     = parseInt($('#delay').value, 10) || 4000;

  const genAI = new GoogleGenAI({ apiKey });

  try {
    log('Fetching JSON…');
    const data = await fetch(jsonUrl).then(r => r.json());
    if (!Array.isArray(data)) throw new Error('JSON is not an array');

    const {start,end} = parseRange(range, data.length);
    const slice = data.slice(start-1, end);
    log(`Processing ${start}-${end} of ${data.length} items`);

    $('#progress').max = slice.length;

    // translate titles
    log('Translating titles…');
    const titles = slice.map(it=>it.title);
    let translatedTitles;
    try {
      const resp = await genAI.models.generateContent({
        model: titleModel,
        contents: titles.join('\n'),
        config: { systemInstruction:"Translate these novel titles accurately to English, preserving their original meaning and style. Return each translated title on a new line in the same order.", safetySettings }
      });
      translatedTitles = resp.text.split('\n');
    } catch {
      log('Batch title failed → falling back to Google');
      translatedTitles = await Promise.all(titles.map(t => googleTranslate(t)));
    }

    // translate content in parallel with delay
    const results = [];
    for (let i=0; i<slice.length; i++) {
      log(`[${i+1}/${slice.length}] Translating: ${translatedTitles[i]}`);
      const res = await translateContent(genAI, slice[i].content, model);
      results.push({
        title: translatedTitles[i] || slice[i].title,
        content: res.text,
        model: res.model
      });
      $('#progress').value = i+1;
      await sleep(delay);
    }

    // download result
    const blob = new Blob([JSON.stringify(results, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `translated_${start}_${end}.json`;
    a.click();
    log('Done! File saved.');
  } catch (err) {
    log('Error: ' + err.message);
  } finally {
    $('#progress').style.display = 'none';
  }
});

const OPENAI_URL = 'https://api.openai.com/v1/responses';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').trim();
    const corsOrigin = allowed && origin === allowed ? origin : (allowed ? allowed : '*');
    const cors = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin'
    };

    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:cors});
    if (request.method !== 'POST') return json({error:'POST only'}, 405, cors);
    if (allowed && origin !== allowed) return json({error:'Origin not allowed'}, 403, cors);
    if (!env.OPENAI_API_KEY) return json({error:'OPENAI_API_KEY is not configured on the Worker.'}, 500, cors);

    let body;
    try { body = await request.json(); } catch { return json({error:'Invalid JSON body'}, 400, cors); }
    const topic = String(body.topic || '').trim().slice(0, 300);
    const difficulty = ['easy','medium','hard','expert'].includes(body.difficulty) ? body.difficulty : 'medium';
    const audience = String(body.audience || 'family').trim().slice(0, 80);
    if (!topic) return json({error:'Topic is required.'}, 400, cors);

    const schema = {
      type:'object', additionalProperties:false,
      properties:{
        category:{type:'string'}, title:{type:'string'}, questionTop:{type:'string'},
        questionHighlight:{type:'string'}, questionBottom:{type:'string'}, fact:{type:'string'},
        answerIndex:{type:'integer', minimum:0, maximum:8},
        choices:{type:'array', minItems:9, maxItems:9, items:{
          type:'object', additionalProperties:false,
          properties:{name:{type:'string'}, value:{type:'string'}, wikiTitle:{type:'string'}},
          required:['name','value','wikiTitle']
        }}
      },
      required:['category','title','questionTop','questionHighlight','questionBottom','fact','answerIndex','choices']
    };

    const system = `You create factual 3x3 elimination puzzles for a family game. Each puzzle must have exactly 9 distinct choices and exactly ONE objectively correct final answer. The player eliminates eight and leaves the answer standing.

Rules:
- Make the requested topic central. Difficulty: ${difficulty}. Audience: ${audience}.
- Prefer stable, independently verifiable facts. Avoid subjective rankings, fuzzy definitions, ties, disputed records, or facts likely to change quickly unless the user explicitly asks for something current.
- If the topic involves a current statistic or record, use web search and anchor the wording to a clear date or season so the answer cannot silently change.
- Independently check all 9 choices so only answerIndex is correct.
- Keep questionTop, questionHighlight, and questionBottom short enough for a phone screen. Put the key superlative/criterion in questionHighlight.
- value is a short supporting fact/value for that choice. Never reveal the answer in the question text.
- wikiTitle must be the best English Wikipedia article title for a representative real photo/image of that choice. For abstract/math choices, use an empty string.
- fact should briefly explain why the winning answer is correct and include the decisive number/date when useful.
- Do not return commentary outside the required JSON object.`;

    const payload = {
      model: env.OPENAI_MODEL || 'gpt-5.6-luna',
      reasoning: {effort:'medium'},
      tools: [{type:'web_search'}],
      input: [
        {role:'system', content:[{type:'input_text', text:system}]},
        {role:'user', content:[{type:'input_text', text:`Create one puzzle about: ${topic}`}]}
      ],
      text: {format:{type:'json_schema', name:'last_one_left_puzzle', strict:true, schema}}
    };

    let api;
    try {
      api = await fetch(OPENAI_URL, {
        method:'POST',
        headers:{'Authorization':`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
    } catch (e) {
      return json({error:'Could not reach the OpenAI API.'}, 502, cors);
    }

    const data = await api.json().catch(()=>({}));
    if (!api.ok) {
      const msg = data?.error?.message || `OpenAI API error ${api.status}`;
      return json({error:msg}, 502, cors);
    }

    const text = extractOutputText(data);
    if (!text) return json({error:'The model returned no puzzle text.'}, 502, cors);
    try {
      const puzzle = JSON.parse(text);
      if (!Array.isArray(puzzle.choices) || puzzle.choices.length !== 9 || puzzle.answerIndex < 0 || puzzle.answerIndex > 8) throw new Error('invalid');
      return json({puzzle}, 200, cors);
    } catch {
      return json({error:'The model response could not be parsed as a valid puzzle. Please try again.'}, 502, cors);
    }
  }
};

function extractOutputText(data) {
  if (typeof data.output_text === 'string') return data.output_text;
  for (const item of data.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {status, headers:{...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}

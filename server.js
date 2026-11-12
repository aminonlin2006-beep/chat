const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 5173;

function mime(p) {
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
  };
  return map[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2e6) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('JSON نامعتبر')); }
    });
    req.on('error', reject);
  });
}

async function callLLM(cfg, messages) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('آدرس پایه API تنظیم نشده است');
  const url = base + '/v1/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (cfg.apiKey || ''),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7,
      max_tokens: cfg.maxTokens || 1200,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('خطای API (' + res.status + '): ' + t.slice(0, 400));
  }
  const j = await res.json();
  const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (typeof content !== 'string') throw new Error('پاسخ مدل ناقص بود');
  const usage = j.usage || null;
  return { content, usage };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/chat') {
      const body = await readBody(req);
      const { content, usage } = await callLLM(body.config, body.messages);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ content, usage }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/summarize') {
      const body = await readBody(req);
      const sys = 'خلاصهی فشرده و ساختاریافته از گفتگوی زیر بنویس. فقط خلاصه را برگردان، بدون توضیح اضافه. طول خلاصه حداکثر ۱۵۰ کلمه باشد.';
      const { content, usage } = await callLLM(body.config, [
        { role: 'system', content: sys },
        ...body.conversation,
      ]);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ summary: content, usage }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/extract') {
      const body = await readBody(req);
      const sys = 'از گفتگوی زیر، واقعیتهای مربوط به کاربر را استخراج کن. هر واقعیت باید دقیقاً همان چیزی باشد که کاربر گفته (نه تفسیر شما). خروجی را بهصورت JSON آرایهی اشیا با کلیدهای text و kind بده؛ kind یا "explicit" است (آنچه کاربر صریحاً گفته) یا "hypothesis" (برداشت شما). فقط JSON برگردان، هیچ چیز دیگری.';
      const { content, usage } = await callLLM(body.config, [
        { role: 'system', content: sys },
        ...body.conversation,
      ]);
      let observations = [];
      try {
        const cleaned = content.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) observations = parsed;
      } catch (e) { /* در صورت خطای پارس، آرایه خالی برمیگردد */ }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ observations, usage }));
      return;
    }

    // فایلهای استاتیک
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const filePath = path.normalize(path.join(PUB_DIR, decodeURIComponent(p)));
    if (!filePath.startsWith(PUB_DIR)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime(filePath) });
    res.end(data);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('مشاور در حال اجراست: http://127.0.0.1:' + PORT);
});

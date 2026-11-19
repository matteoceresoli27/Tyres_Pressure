// M4 GT4 Mileage – server per Render (piano gratuito).
// Serve l'app, tiene i dati condivisi e invia gli aggiornamenti in diretta (SSE).
// I dati vengono salvati in un file JSON su un ramo separato del repository GitHub,
// così non si perdono quando Render mette in pausa il servizio gratuito.
//
// Variabili d'ambiente (Render → Environment):
//   GITHUB_TOKEN  token GitHub "fine-grained" con permesso Contents: Read and write sul repository
//   GITHUB_REPO   es. "utente/m4-gt4-mileage"
//   DATA_BRANCH   ramo dove salvare i dati (predefinito "data")
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPO || '';
const BRANCH = process.env.DATA_BRANCH || 'data';
const API = process.env.GITHUB_API || 'https://api.github.com';
const FILE = 'm4gt4-state.json';
const PERSIST = !!(TOKEN && REPO);
const INDEX = path.join(__dirname, 'index.html');

let state = { rev: 0, at: 0, json: null };
let sha = null;
let ready = false;
let lastErr = '';
const clients = new Set();

function gh(p, opt = {}) {
  return fetch(API + '/repos/' + REPO + p, {
    ...opt,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'm4gt4-mileage',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(opt.headers || {}),
    },
  });
}

async function ensureBranch() {
  const b = await gh('/branches/' + encodeURIComponent(BRANCH));
  if (b.ok) return;
  if (b.status !== 404) throw new Error('GitHub branches ' + b.status);
  const repo = await gh('');
  if (!repo.ok) throw new Error('Repository non trovato o token senza accesso (' + repo.status + ')');
  const def = (await repo.json()).default_branch;
  const ref = await gh('/git/ref/heads/' + encodeURIComponent(def));
  if (!ref.ok) throw new Error('GitHub ref ' + ref.status);
  const base = (await ref.json()).object.sha;
  const c = await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + BRANCH, sha: base }) });
  if (!c.ok && c.status !== 422) throw new Error('Creazione ramo ' + BRANCH + ' non riuscita (' + c.status + ')');
}

async function load() {
  if (!PERSIST) { ready = true; console.log('ATTENZIONE: GITHUB_TOKEN/GITHUB_REPO mancanti, dati solo in memoria'); return; }
  await ensureBranch();
  const r = await gh('/contents/' + FILE + '?ref=' + encodeURIComponent(BRANCH));
  if (r.status === 404) { ready = true; console.log('Nessun archivio: verrà creato al primo salvataggio'); return; }
  if (!r.ok) throw new Error('Lettura archivio GitHub ' + r.status);
  const j = await r.json();
  sha = j.sha;
  let txt;
  if (j.content) txt = Buffer.from(j.content, 'base64').toString('utf8');
  else { // file > 1 MB: scarica il contenuto grezzo
    const raw = await gh('/contents/' + FILE + '?ref=' + encodeURIComponent(BRANCH), { headers: { Accept: 'application/vnd.github.raw+json' } });
    txt = await raw.text();
  }
  const d = JSON.parse(txt);
  state = { rev: d.rev || 1, at: d.at || Date.now(), json: d.json || null };
  ready = true;
  console.log('Archivio caricato, rev', state.rev);
}

async function boot() {
  for (let i = 1; ; i++) {
    try { await load(); lastErr = ''; return; }
    catch (e) { lastErr = String(e.message || e); console.error('Avvio:', lastErr); await new Promise(r => setTimeout(r, Math.min(30000, 2000 * i))); }
  }
}

let saving = false, dirty = false, retryT = null;
async function flush() {
  if (!PERSIST) return;
  if (saving) { dirty = true; return; }
  saving = true;
  try {
    do {
      dirty = false;
      const snap = state;
      const body = { message: 'Dati app – rev ' + snap.rev, content: Buffer.from(JSON.stringify(snap)).toString('base64'), branch: BRANCH };
      if (sha) body.sha = sha;
      const r = await gh('/contents/' + FILE, { method: 'PUT', body: JSON.stringify(body) });
      if (r.status === 409 || r.status === 422) {
        const g = await gh('/contents/' + FILE + '?ref=' + encodeURIComponent(BRANCH));
        if (!g.ok) throw new Error('GitHub ' + g.status);
        sha = (await g.json()).sha; dirty = true; continue;
      }
      if (!r.ok) throw new Error('Salvataggio GitHub ' + r.status);
      sha = (await r.json()).content.sha;
      lastErr = '';
    } while (dirty);
  } catch (e) {
    lastErr = String(e.message || e); console.error(lastErr);
    clearTimeout(retryT); retryT = setTimeout(flush, 10000);
  } finally { saving = false; }
}

function send(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(b);
}
function pub() { return { rev: state.rev, at: state.at, json: state.json, persisted: PERSIST, err: lastErr }; }
function broadcast() {
  const msg = 'data: ' + JSON.stringify(pub()) + '\n\n';
  for (const c of clients) c.write(msg);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/healthz') return send(res, 200, { ok: true, ready, err: lastErr });

  if (p.startsWith('/api/')) {
    if (!ready) return send(res, 503, { err: 'Server in avvio, riprova tra qualche secondo. ' + lastErr });

    if (p === '/api/state' && req.method === 'GET') return send(res, 200, pub());

    if (p === '/api/state' && req.method === 'POST') {
      let size = 0; const chunks = [];
      req.on('data', c => { size += c.length; if (size > 3e6) { req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        let b;
        try { b = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { err: 'Dati non validi' }); }
        if (typeof b.json !== 'string') return send(res, 400, { err: 'Dati non validi' });
        try { const o = JSON.parse(b.json); if (!o || !Array.isArray(o.cars)) throw 0; } catch { return send(res, 400, { err: 'Archivio non valido' }); }
        if (b.base !== state.rev) return send(res, 409, pub());
        state = { rev: state.rev + 1, at: Date.now(), json: b.json };
        send(res, 200, { rev: state.rev, at: state.at });
        broadcast(); flush();
      });
      return;
    }

    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      res.write('data: ' + JSON.stringify(pub()) + '\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    return send(res, 404, { err: 'Non trovato' });
  }

  if (p === '/' || p === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); return res.end('index.html mancante'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(302, { Location: '/' }); res.end();
});

setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);
server.listen(PORT, () => console.log('M4 GT4 Mileage in ascolto sulla porta', PORT));
boot();

// Cloudflare Pages Function : /api/scores
// 世界の国チャンピオン ― レベル×モード別オンラインランキング。
// KV名前空間を "SCORES" という名前でこのPagesプロジェクトにバインドすること。
// GET  /api/scores?level=el_cap             → {top:[{name,score} x5]}
// POST /api/scores {level:"el_cap",name,score} → {top:[...5], rank, total, you:{name,score}}
//
// level は「難易度_モード」の組み合わせ:
//   難易度 el(小)=10点 / jr(中)=15点 / sr(高)=20点   × 10問
//   モード cap(首都) / fam(名物) / exp(輸出品)

const LV_MAX = { el: 100, jr: 150, sr: 200 }; // 1問点数 × 10問
const MODES = ["cap", "fam", "exp"];
const KEEP = 50; // KVに保持する件数（表示は上位5件）

function parseBoard(board) {
  if (typeof board !== "string") return null;
  const [lv, md] = board.split("_");
  if (!(lv in LV_MAX) || !MODES.includes(md)) return null;
  return { lv, md, max: LV_MAX[lv] };
}

// 初期ダミーランキング（KVが空のとき表示。実プレイヤーが登録すると混ざって競える）
const SEED_NAMES = {
  el: ["たろう", "はなこ", "ケンタ", "ミク", "そら"],
  jr: ["ゆうき", "あおい", "ダイチ", "リン", "ナナ"],
  sr: ["はかせ", "ソウマ", "ちづる", "ケイ", "ユウ"]
};
function seedBoard(lv) {
  const max = LV_MAX[lv];
  const names = SEED_NAMES[lv] || SEED_NAMES.el;
  // 最高点の 90%,80%,...,50% を配点。同点なら先着扱い(小さいts)。
  return names.map((name, i) => ({ name, score: Math.round(max * (0.9 - i * 0.1)), ts: i, seed: true }));
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

const key = (board) => "board:" + board;
const pub = (e) => ({ name: e.name, score: e.score });

async function readBoard(env, board, lv) {
  if (!env || !env.SCORES) throw new Error("KV binding 'SCORES' not found");
  const raw = await env.SCORES.get(key(board));
  if (!raw) return seedBoard(lv);
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) && a.length ? a : seedBoard(lv);
  } catch (e) { return seedBoard(lv); }
}

function sanitizeName(n) {
  n = (n == null ? "" : String(n));
  n = n.split("").filter((ch) => { const c = ch.charCodeAt(0); return c >= 32 && c !== 127; }).join("").trim();
  n = [...n].slice(0, 5).join("");
  return n || "ゲスト";
}

export async function onRequestGet(context) {
  try {
    const board = new URL(context.request.url).searchParams.get("level");
    const p = parseBoard(board);
    if (!p) return json({ error: "bad level" }, 400);
    const data = await readBoard(context.env, board, p.lv);
    return json({ top: data.slice(0, 5).map(pub) });
  } catch (e) {
    return json({ error: "server", detail: String((e && e.message) || e) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    let { level: board, name, score } = body || {};
    const p = parseBoard(board);
    if (!p) return json({ error: "bad level" }, 400);
    score = Math.floor(Number(score));
    if (!Number.isFinite(score) || score < 0 || score > p.max) return json({ error: "bad score" }, 400);
    name = sanitizeName(name);

    const data = await readBoard(context.env, board, p.lv);
    const entry = { name, score, ts: Date.now() };
    data.push(entry);
    data.sort((a, b) => b.score - a.score || a.ts - b.ts); // 高得点順・同点は先着
    const trimmed = data.slice(0, KEEP);
    await context.env.SCORES.put(key(board), JSON.stringify(trimmed));

    const idx = trimmed.indexOf(entry);
    return json({
      top: trimmed.slice(0, 5).map(pub),
      rank: idx >= 0 ? idx + 1 : null,
      total: trimmed.length,
      you: { name: entry.name, score: entry.score }
    });
  } catch (e) {
    return json({ error: "server", detail: String((e && e.message) || e) }, 500);
  }
}

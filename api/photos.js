// Desafio Ohana — fotos da turma (Vercel + Upstash Redis, sem dependências)
// "ohana50:fotos"            -> lista de ids (mais recente primeiro)
// "ohana50:foto:<id>"        -> hash { m: JSON(meta), img: base64 JPEG }
// "ohana50:curt:<id>"        -> set de pessoas que curtiram
const PEOPLE = ["giovani", "rafaele", "marcia", "wagner", "jessica", "guilherme"];
const LIST = "ohana50:fotos";
const MAX_LIST = 800;
const MAX_IMG = 450000; // ~330 KB de JPEG em base64

function cfg() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}
async function pipeline(c, cmds) {
  const r = await fetch(c.url + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + c.token, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return r.json();
}
const ID_RE = /^[a-z0-9]{6,24}$/;

module.exports = async (req, res) => {
  const c = cfg();
  if (!c) return res.status(500).json({ error: "no_db" });
  try {
    if (req.method === "GET") {
      const q = req.query || {};
      // imagem
      if (q.img) {
        if (!ID_RE.test(q.img)) return res.status(400).end();
        const [o] = await pipeline(c, [["HGET", "ohana50:foto:" + q.img, "img"]]);
        if (!o || !o.result) return res.status(404).end();
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
        return res.status(200).send(Buffer.from(o.result, "base64"));
      }
      // feed
      res.setHeader("Cache-Control", "no-store");
      const [l] = await pipeline(c, [["LRANGE", LIST, "0", "199"]]);
      const ids = (l && l.result) || [];
      if (!ids.length) return res.status(200).json({ fotos: [] });
      const cmds = [];
      ids.forEach(id => { cmds.push(["HGET", "ohana50:foto:" + id, "m"]); cmds.push(["SMEMBERS", "ohana50:curt:" + id]); });
      const out = await pipeline(c, cmds);
      const fotos = [];
      ids.forEach((id, i) => {
        const m = out[i * 2] && out[i * 2].result;
        if (!m) return;
        try { const meta = JSON.parse(m); meta.id = id; meta.curtidas = (out[i * 2 + 1] && out[i * 2 + 1].result) || []; fotos.push(meta); } catch (e) {}
      });
      return res.status(200).json({ fotos });
    }

    if (req.method === "POST") {
      res.setHeader("Cache-Control", "no-store");
      let b = req.body;
      if (typeof b === "string") b = JSON.parse(b || "{}");
      b = b || {};
      if (!PEOPLE.includes(b.person)) return res.status(400).json({ error: "person" });

      if (b.acao === "curtir") {
        if (!ID_RE.test(b.id || "")) return res.status(400).json({ error: "id" });
        await pipeline(c, [[b.on ? "SADD" : "SREM", "ohana50:curt:" + b.id, b.person]]);
        return res.status(200).json({ ok: true });
      }

      if (b.acao === "apagar") {
        if (!ID_RE.test(b.id || "")) return res.status(400).json({ error: "id" });
        const [o] = await pipeline(c, [["HGET", "ohana50:foto:" + b.id, "m"]]);
        const meta = o && o.result ? JSON.parse(o.result) : null;
        if (!meta || meta.person !== b.person) return res.status(403).json({ error: "dono" });
        await pipeline(c, [["LREM", LIST, "0", b.id], ["DEL", "ohana50:foto:" + b.id], ["DEL", "ohana50:curt:" + b.id]]);
        return res.status(200).json({ ok: true });
      }

      // nova foto
      const day = Number(b.day), habit = Number(b.habit);
      if (!Number.isInteger(day) || day < 1 || day > 58) return res.status(400).json({ error: "day" });
      if (!Number.isInteger(habit) || habit < 0 || habit > 3) return res.status(400).json({ error: "habit" });
      const img = typeof b.img === "string" ? b.img : "";
      if (!img.startsWith("/9j/") || img.length > MAX_IMG) return res.status(400).json({ error: "img" });
      const legenda = typeof b.legenda === "string" ? b.legenda.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 140) : "";
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const meta = { person: b.person, day, habit, ts: Date.now(), legenda };
      await pipeline(c, [
        ["HSET", "ohana50:foto:" + id, "m", JSON.stringify(meta), "img", img],
        ["LPUSH", LIST, id],
        ["LTRIM", LIST, "0", String(MAX_LIST - 1)],
      ]);
      meta.id = id; meta.curtidas = [];
      return res.status(200).json({ ok: true, foto: meta });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: "db_error" });
  }
};

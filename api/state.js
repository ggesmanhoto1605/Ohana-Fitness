// Desafio Ohana — API de marcações (Vercel + Upstash Redis, sem dependências)
// Campos por pessoa (hash "ohana50:<pessoa>"):
//   "<dia>_<0..3>"  -> % do hábito no dia (10..100). Valor antigo "1" = 100%.
//   "<dia>_an|as"   -> álcool não/sim ("1")
//   "meta_<0..3>"   -> texto da meta pessoal de cada hábito
const PEOPLE = ["giovani", "rafaele", "marcia", "wagner", "jessica", "guilherme"];
const DAY = "([1-9]|[1-4][0-9]|5[0-8])";
const HAB_RE = new RegExp("^" + DAY + "_(0|1|2|3)$");
const ALC_RE = new RegExp("^" + DAY + "_(an|as)$");
const META_RE = /^meta_[0-3]$/;

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

// aceita "id" (formato antigo, vale "1") ou {id, v}
function normalize(item) {
  const id = typeof item === "string" ? item : item && item.id;
  const v = typeof item === "string" ? "1" : item && item.v;
  if (typeof id !== "string") return null;
  if (HAB_RE.test(id)) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 100) return null;
    return [id, String(n)];
  }
  if (ALC_RE.test(id)) return [id, "1"];
  if (META_RE.test(id)) {
    if (typeof v !== "string") return null;
    const t = v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200);
    return t ? [id, t] : null;
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const c = cfg();
  if (!c) return res.status(500).json({ error: "no_db" });
  try {
    if (req.method === "GET") {
      const out = await pipeline(c, PEOPLE.map(p => ["HGETALL", "ohana50:" + p]));
      const people = {};
      PEOPLE.forEach((p, i) => {
        const arr = (out[i] && out[i].result) || [];
        const o = {};
        for (let j = 0; j < arr.length; j += 2) o[arr[j]] = arr[j + 1];
        people[p] = o;
      });
      return res.status(200).json({ people });
    }
    if (req.method === "POST") {
      let b = req.body;
      if (typeof b === "string") b = JSON.parse(b || "{}");
      const person = b && b.person;
      const set = Array.isArray(b && b.set) ? b.set : [];
      const unset = Array.isArray(b && b.unset) ? b.unset : [];
      if (!PEOPLE.includes(person)) return res.status(400).json({ error: "person" });
      if (!set.length && !unset.length) return res.status(400).json({ error: "empty" });
      if (set.length + unset.length > 8) return res.status(400).json({ error: "too_many" });
      const pairs = set.map(normalize);
      if (pairs.some(p => !p)) return res.status(400).json({ error: "id" });
      if (!unset.every(id => typeof id === "string" && (HAB_RE.test(id) || ALC_RE.test(id) || META_RE.test(id))))
        return res.status(400).json({ error: "id" });
      const k = "ohana50:" + person;
      const cmds = [];
      unset.forEach(id => cmds.push(["HDEL", k, id]));
      pairs.forEach(([id, v]) => cmds.push(["HSET", k, id, v]));
      await pipeline(c, cmds);
      return res.status(200).json({ ok: true });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: "db_error" });
  }
};

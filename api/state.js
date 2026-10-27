// Desafio Ohana — API de marcações (Vercel + Upstash Redis, sem dependências)
const PEOPLE = ["giovani", "rafaele", "marcia", "wagner", "jessica", "guilherme"];
const ID_RE = /^([1-9]|[1-4][0-9]|5[0-8])_(0|1|2|3|an|as)$/;

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
        for (let j = 0; j < arr.length; j += 2) o[arr[j]] = 1;
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
      const ids = set.concat(unset);
      if (!ids.length || ids.length > 4 || !ids.every(id => typeof id === "string" && ID_RE.test(id)))
        return res.status(400).json({ error: "id" });
      const k = "ohana50:" + person;
      const cmds = [];
      unset.forEach(id => cmds.push(["HDEL", k, id]));
      set.forEach(id => cmds.push(["HSET", k, id, "1"]));
      await pipeline(c, cmds);
      return res.status(200).json({ ok: true });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: "db_error" });
  }
};

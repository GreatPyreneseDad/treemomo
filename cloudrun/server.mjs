// TreeMomo API on Google Cloud: Cloud Run + Cloud SQL (Postgres) + Cloud Storage,
// Google Geocoding + Google Weather for place and moment, Gemini (Argon) for the eyes.
import http from "node:http";
import crypto from "node:crypto";
import postgres from "postgres";
import { Storage } from "@google-cloud/storage";
import { OAuth2Client } from "google-auth-library";
import { WATCH, FIT, MOD, CLEAN, HUG, READ } from "./prompts.mjs";

const KEY = process.env.GEMINI_API_KEY ?? "";
const GKEY = process.env.GOOGLE_SERVER_KEY ?? "";
const MODEL = process.env.TM_ARGON_MODEL ?? "gemini-4-argon";
const BUCKET = process.env.TM_BUCKET ?? "treemomo-app-videos";
const G = "https://generativelanguage.googleapis.com";
const sql = postgres({
  host: process.env.DB_SOCKET ?? "/cloudsql/treemomo-app:us-west1:treemomo-db",
  database: "treemomo", username: "postgres", password: process.env.DB_PASSWORD, max: 5, idle_timeout: 30,
});
const bucket = new Storage().bucket(BUCKET);
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "494547807299-apqm0tgrjsnceufaihuv0u9mrd5bijnu.apps.googleusercontent.com";
const oauth = new OAuth2Client(CLIENT_ID);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-tm-player", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const clip = (s, n) => String(s ?? "").slice(0, n);
const J = (o) => sql.json(o ?? null);

async function argon(parts, system, maxTokens = 6000, think = "low") {
  const body = (t) => JSON.stringify({
    systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.8, responseMimeType: "application/json", ...(t ? { thinkingConfig: { thinkingLevel: think, includeThoughts: false } } : {}) },
  });
  const url = `${G}/v1beta/models/${MODEL}:generateContent`, h = { "content-type": "application/json", "x-goog-api-key": KEY };
  let r = await fetch(url, { method: "POST", headers: h, body: body(true) });
  if (r.status === 400) r = await fetch(url, { method: "POST", headers: h, body: body(false) });
  if (!r.ok) throw new Error(`argon ${r.status}: ${clip(await r.text(), 200)}`);
  const j = await r.json();
  const txt = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  return JSON.parse(txt.replace(/^```json\s*|```$/g, ""));
}

async function toGemini(bytes, mime) {
  const start = await fetch(`${G}/upload/v1beta/files`, { method: "POST", headers: { "x-goog-api-key": KEY, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
    "X-Goog-Upload-Header-Content-Length": String(bytes.length), "X-Goog-Upload-Header-Content-Type": mime, "content-type": "application/json" }, body: JSON.stringify({ file: { display_name: "tree" } }) });
  if (!start.ok) throw new Error(`upload start ${start.status}`);
  const up = await fetch(start.headers.get("x-goog-upload-url"), { method: "POST", headers: { "Content-Length": String(bytes.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: bytes });
  let f = (await up.json()).file;
  for (let i = 0; i < 60 && f?.state === "PROCESSING"; i++) { await new Promise((r) => setTimeout(r, 1500)); f = await (await fetch(`${G}/v1beta/${f.name}`, { headers: { "x-goog-api-key": KEY } })).json(); }
  if (f?.state !== "ACTIVE") throw new Error(`video not ready: ${f?.state}`);
  return f.uri;
}

const SAFE_TAGS = /^(g|path|circle|ellipse|rect|polygon|polyline|line)$/;
function sanitize(svg) {
  const s = String(svg ?? "").replace(/<\/?svg[^>]*>/g, "").trim();
  if (!s || s.length > 9000 || /script|on[a-z]+\s*=|href|url\(|<!|foreignObject|<image|<use|style\s*=/i.test(s)) return null;
  return [...s.matchAll(/<\/?\s*([a-zA-Z]+)/g)].every((m) => SAFE_TAGS.test(m[1])) ? s : null;
}

// Google Geocoding: neighborhood / city for the Momo's first name.
async function placeName(lat, lng) {
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=neighborhood|sublocality|locality&key=${GKEY}`, { signal: AbortSignal.timeout(3500) });
    const res = (await r.json())?.results ?? [];
    const comp = (type, short = false) => { for (const x of res) for (const c of x.address_components ?? []) if (c.types.includes(type)) return short ? c.short_name : c.long_name; return null; };
    const p = { neighborhood: comp("neighborhood") ?? comp("sublocality"), city: comp("locality") ?? comp("administrative_area_level_2"), state: comp("administrative_area_level_1", true), source: "google" };
    return p.neighborhood || p.city ? p : null;
  } catch { return null; }
}

// Google Weather: current conditions at the tree.
async function weatherAt(lat, lng) {
  try {
    const r = await fetch(`https://weather.googleapis.com/v1/currentConditions:lookup?key=${GKEY}&location.latitude=${lat}&location.longitude=${lng}&unitsSystem=IMPERIAL`, { signal: AbortSignal.timeout(3500) });
    const c = await r.json(); if (!c?.weatherCondition) return null;
    let local = c.currentTime;
    try { local = new Date(c.currentTime).toLocaleString("en-US", { timeZone: c.timeZone?.id, weekday: "short", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }); } catch {}
    return { temp_f: Math.round(c.temperature?.degrees), feels_f: Math.round(c.feelsLikeTemperature?.degrees), sky: (c.weatherCondition.description?.text ?? "unknown").toLowerCase(),
      wind_mph: Math.round(c.wind?.speed?.value ?? 0), humidity: c.relativeHumidity, day: !!c.isDaytime, uv: c.uvIndex, local_time: local, source: "google" };
  } catch { return null; }
}

const chronicle = (tree) => sql`select kind,text,author,weather,verified,at from tm_chronicle where tree=${tree} order by at desc limit 40`;

function meters(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const BADGE = { id: "friend-of-the-tall", name: "Friend of the Tall", need: 5 };
const HUGGER = { id: "tree-hugger", name: "Tree Hugger", need: 10 };
const mimeOf = (vp) => { const ext = vp.split(".").pop(); return ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : ext === "3gp" ? "video/3gpp" : "video/mp4"; };
const openQuest = async (tree) => (await sql`select id,ask,litter,created_at from tm_quests where tree=${tree} and status='open' limit 1`)[0] ?? null;
async function standing(player) {
  const [{ n }] = await sql`select count(distinct tree)::int n from tm_quests where done_by=${player} and status='done'`;
  const badges = await sql`select badge,at from tm_badges where player=${player}`;
  const [{ h }] = await sql`select count(*)::int h from tm_hugs where player=${player}`;
  const [u] = await sql`select name,email,picture from tm_users where primary_player=${player}`;
  return { user: u ?? null, cleaned_trees: n, hugs: h, badge: { ...BADGE, have: badges.some((b) => b.badge === BADGE.id) }, hugger: { ...HUGGER, have: badges.some((b) => b.badge === HUGGER.id) }, badges };
}
const userOf = async (player) => (await sql`select id,name,email from tm_users where primary_player=${player}`)[0] ?? null;
const openGift = async (tree) => (await sql`select id,tree,title,from_name,how,poem,giver from tm_gifts where tree=${tree} and status='open' limit 1`)[0] ?? null;
const giftPublic = (g, withPoem) => g ? { id: g.id, title: g.title, from: g.from_name, how: g.how, poem: withPoem ? g.poem : null } : null;
// how much of the poem was really said: longest common word sequence between a blind transcript and the poem
const words = (t) => String(t ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter((w) => w.length > 1);
function coverage(poem, said) {
  const A = words(poem), B = words(said); if (!A.length || !B.length) return 0;
  let prev = new Array(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) { const cur = [0]; for (let j = 1; j <= B.length; j++) cur[j] = A[i - 1] === B[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]); prev = cur; }
  return prev[B.length] / A.length;
}
// Families: Momos of the same species living in the same area (within 1.5 km) share a family tag.
const normSp = (x) => String(x ?? "").toLowerCase().replace(/crepe/g, "crape").replace(/grey/g, "gray").replace(/\(.*?\)|'.*?'/g, "").replace(/[^a-z ]/g, " ").trim().split(/\s+/).filter((w) => w.length > 2 && !["tree", "common"].includes(w));
const sameSp = (x, y) => { const A = normSp(x), B = normSp(y); return A.length > 0 && B.length > 0 && A[A.length - 1] === B[B.length - 1] && (A.length < 2 || B.length < 2 || A.join(" ") === B.join(" ") || A.slice(-2).join(" ") === B.slice(-2).join(" ")); };
const FAMILY_M = 1500;
async function familyOf(treeId) {
  const [t] = await sql`select family from tm_trees where id=${treeId}`;
  if (!t?.family) return null;
  const [f] = await sql`select id,name,note from tm_families where id=${t.family}`;
  const members = await sql`select id, momo->>'name' name from tm_trees where family=${t.family} order by first_seen`;
  return f ? { ...f, members: members.map((m) => ({ id: m.id, name: m.name })) } : null;
}
async function assignFamily(treeId) {
  const [t] = await sql`select id,lat,lng,species,family,place, momo->>'name' name from tm_trees where id=${treeId}`;
  if (!t || t.lat == null || !t.species || t.family) return familyOf(treeId);
  const near = await sql`select id,lat,lng,species,family,place, momo->>'name' name from tm_trees where id<>${t.id} and momo is not null
    and lat between ${t.lat - 0.0136} and ${t.lat + 0.0136} and lng between ${t.lng - 0.0172} and ${t.lng + 0.0172}`;
  const sibs = [...near].filter((x) => sameSp(x.species, t.species) && meters(t, x) <= FAMILY_M);
  if (!sibs.length) return null;
  let fam = sibs.find((x) => x.family)?.family;
  if (!fam) {
    const where = [t.place?.neighborhood, t.place?.city].filter(Boolean).join(", ");
    const n = await argon([{ text: JSON.stringify({ place: where || "unknown", species: t.species, members: [t.name, ...sibs.map((x) => x.name)] }) }],
      `These Momos are the same kind of tree living in the same area, so they are one family. Give the family a short tag (2 to 4 words) rooted in the place, the way people remember a neighborhood's trees: like "the Ferry Planes" or "the Waterfront Palms". Respectful, never a stereotype. Reply JSON only: {"name": "...", "note": "one short line about this family and its place"}`, 300, "low").catch(() => null);
    const name = clip(n?.name, 50) || `the ${where.split(",")[0] || "Neighborhood"} ${String(t.species).split(/\s+/).pop()}s`;
    [{ id: fam }] = await sql`insert into tm_families (name,note,species,lat,lng) values (${name},${clip(n?.note, 200) || null},${t.species},${t.lat},${t.lng}) returning id`;
  }
  const ids = [t.id, ...sibs.filter((x) => !x.family).map((x) => x.id)];
  await sql`update tm_trees set family=${fam} where id in ${sql(ids)}`;
  return familyOf(t.id);
}
const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s ?? ""));

async function route(req, url, path, player, body) {
  if (path === "/config") return [200, { maps_key: process.env.MAPS_BROWSER_KEY ?? "", google_client_id: CLIENT_ID }];
  if (path === "/health") return [200, { ok: true, db: (await sql`select count(*)::int n from tm_trees`)[0].n }];
  if (path === "/upload-url" && req.method === "POST") {
    if (player.length < 16) return [401, { error: "no player" }];
    const ext = /^(mp4|mov|webm|m4v|3gp)$/i.test(body.ext) ? body.ext.toLowerCase() : "mp4";
    const p = `${player.slice(0, 16)}/${crypto.randomUUID()}.${ext}`;
    const [u] = await bucket.file(p).getSignedUrl({ version: "v4", action: "write", expires: Date.now() + 15 * 60 * 1000 });
    return [200, { path: p, url: u }];
  }
  if (path === "/analyze" && req.method === "POST") {
    if (player.length < 16) return [401, { error: "no player" }];
    const vp = clip(body.path, 120);
    if (!vp.startsWith(player.slice(0, 16) + "/")) return [403, { error: "not your video" }];
    let bytes;
    try { [bytes] = await bucket.file(vp).download(); } catch { return [404, { error: "video missing" }]; }
    const ext = vp.split(".").pop();
    const mime = ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : ext === "3gp" ? "video/3gpp" : "video/mp4";
    const lat = Number(body.lat), lng = Number(body.lng), hasLoc = Number.isFinite(lat) && Number.isFinite(lng) && !(body.lat == null);
    const [uri, near, place, weather, hood] = await Promise.all([
      toGemini(bytes, mime),
      hasLoc ? sql`select id,lat,lng,visits,momo,species,health from tm_trees where lat between ${lat - 0.0003} and ${lat + 0.0003} and lng between ${lng - 0.0004} and ${lng + 0.0004}` : [],
      hasLoc ? placeName(lat, lng) : null, hasLoc ? weatherAt(lat, lng) : null,
      hasLoc ? sql`select momo->>'name' n, momo->>'first_name' f from tm_trees where momo is not null and lat between ${lat - 0.018} and ${lat + 0.018} and lng between ${lng - 0.023} and ${lng + 0.023}` : []]);
    const cands = [...near].map((t) => ({ ...t, d: meters({ lat, lng }, t) })).filter((t) => t.d < 15).sort((x, y) => x.d - y.d).slice(0, 6);
    const where = place ? [place.neighborhood, place.city, place.state].filter(Boolean).join(", ") : "";
    const known = cands.map((t, i) => `T${i + 1}: ${t.species ?? "unknown species"}, ~${Math.round(t.d)} m away, height ~${t.health?.height_m ?? "?"} m${t.momo ? `, resident Momo ${t.momo.name}` : ""}`);
    const ctx = [`The player is at ${hasLoc ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : "an unknown location"}${where ? ` (${where})` : ""}.`,
      weather ? `Weather right now: ${weather.sky}, ${weather.temp_f}°F (feels ${weather.feels_f}°F), wind ${weather.wind_mph} mph, humidity ${weather.humidity}%, ${weather.day ? "daytime" : "night"}, local time ${weather.local_time}.` : "",
      known.length ? `Trees already known within 15 m of the player (GPS is approximate, and different trees often stand close together):\n${known.join("\n")}\nSet tree.match to the key (like "T1") ONLY if the tree in this clip is that same individual tree: same species, matching size and look. A different species is never a match. Otherwise null. If you match one that has a resident Momo, don't design a new Momo: return momo.name exactly as the resident's, leave momo.svg empty and give momo.mood.` : "No trees are known near here yet: this tree has no Momo, so you are designing its first and only resident.",
      hood.length ? `Momos already living in this area: ${[...hood].map((h) => h.n).join(", ")}. A new Momo must get a first name none of them use: people remember places by these names, so reach for a different local thread (a street, pier, landmark, hill, creek, a piece of the area's history, its people, languages, food or music).` : "",
      body.note ? "They said: " + clip(body.note, 200) : ""].filter(Boolean).join("\n");
    const a = await argon([{ file_data: { mime_type: mime, file_uri: uri } }, { text: ctx }], WATCH, 9000, "low");
    if (a?.tree?.is_tree === false) return [422, { error: "No tree in that clip. Film a real tree: trunk, branches and leaves, about 10 seconds." }];
    const norm = (x) => String(x ?? "").toLowerCase().replace(/crepe/g, "crape").replace(/grey/g, "gray").replace(/\(.*?\)|'.*?'/g, "").replace(/[^a-z ]/g, " ").trim().split(/\s+/).filter((w) => w.length > 2 && !["tree", "common"].includes(w));
    const sameSpecies = (x, y) => { const A = norm(x), B = norm(y); return A.length > 0 && B.length > 0 && A[A.length - 1] === B[B.length - 1] && (A.length < 2 || B.length < 2 || A.join(" ") === B.join(" ") || A.slice(-2).join(" ") === B.slice(-2).join(" ")); };
    const mi = /^T(\d+)$/.exec(String(a?.tree?.match ?? ""));
    const cand = mi ? cands[Number(mi[1]) - 1] : null;
    const treeRow = cand && sameSpecies(cand.species, a?.tree?.species) ? cand : null;
    const resident = treeRow?.momo ?? null;
    const fresh = sanitize(a?.momo?.svg);
    if (!resident && a?.momo?.name) {
      const taken = new Set([...hood].flatMap((h) => [h.n, h.f]).filter(Boolean).map((x) => x.toLowerCase()));
      const [{ dup }] = await sql`select count(*)::int dup from tm_trees where lower(momo->>'name')=${String(a.momo.name).toLowerCase()}`;
      if (dup || taken.has(String(a.momo.first_name ?? "").toLowerCase())) {
        const line = String(a.momo.name).split(/\s+/).slice(1).join(" ") || a.momo.name;
        const nn = await argon([{ text: JSON.stringify({ place: where || "unknown", tree: a.tree?.species, momo_line_name: line, taken_names: [...taken], current: a.momo.name }) }],
          `Give this Momo a new first name that belongs to the place, so a player remembers where they found it. Draw on a local street, pier, landmark, hill, creek, history, people, language, food or music a local would recognize. Respectful, never a stereotype. It must differ from every taken name. Keep the line name. Reply JSON only: {"name": "First LineName", "first_name": "...", "place_note": "one short line on what the first name refers to"}`, 300, "low").catch(() => null);
        if (nn?.first_name && !taken.has(String(nn.first_name).toLowerCase())) a.momo = { ...a.momo, name: clip(nn.name, 60) || `${nn.first_name} ${line}`, first_name: clip(nn.first_name, 30), place_note: clip(nn.place_note, 200) || a.momo.place_note };
      }
    }
    const momo = resident ? { ...resident, mood: clip(a?.momo?.mood, 80) || null } : { ...a.momo, svg: fresh ?? `<circle cx="100" cy="110" r="60" fill="#8fbf6a" stroke="#1d1a17" stroke-width="3"/><circle cx="80" cy="100" r="12" fill="#fff" stroke="#1d1a17" stroke-width="3"/><circle cx="120" cy="100" r="12" fill="#fff" stroke="#1d1a17" stroke-width="3"/><circle cx="82" cy="102" r="5" fill="#1d1a17"/><circle cx="122" cy="102" r="5" fill="#1d1a17"/>` };
    const hide = a.hideout ?? {};
    const placement = { t: Math.max(0, Number(hide.t) || 0), x: Math.min(0.95, Math.max(0.05, Number(hide.x) || 0.5)), y: Math.min(0.95, Math.max(0.05, Number(hide.y) || 0.5)), size: Math.min(0.4, Math.max(0.06, Number(hide.size) || 0.18)), peek: hide.peek ?? "none", why: clip(hide.why, 300), flip: false };
    let treeId;
    if (treeRow) {
      treeId = treeRow.id;
      await sql`update tm_trees set visits=visits+1, last_seen=now(), health=${J(a.tree)}, momo=coalesce(momo, ${J(momo)}), place=coalesce(${place ? J(place) : null}, place) where id=${treeId}`;
    } else {
      [{ id: treeId }] = await sql`insert into tm_trees (lat,lng,accuracy_m,species,species_confidence,health,momo,place) values (${hasLoc ? lat : null},${hasLoc ? lng : null},${Number(body.acc) || null},${a.tree?.species ?? null},${Number(a.tree?.confidence) || null},${J(a.tree)},${J(momo)},${J(place)}) returning id`;
    }
    let sponsor = null;
    if (hasLoc) {
      const sp = await sql`select id,name,offer,lat,lng,radius_m,demo from tm_sponsors where active and lat between ${lat - 0.02} and ${lat + 0.02}`;
      const s = [...sp].map((x) => ({ ...x, d: Math.round(meters({ lat, lng }, x)) })).filter((x) => x.d <= x.radius_m).sort((x, y) => x.d - y.d)[0];
      if (s) sponsor = { name: s.name, offer: s.offer, distance_m: s.d, demo: s.demo };
    }
    const [{ id: sid }] = await sql`insert into tm_sightings (tree,player,video_path,analysis,momo,placement,sponsor) values (${treeId},${player},${vp},${J(a)},${J(momo)},${J(placement)},${J(sponsor)}) returning id`;
    if (a.moment) await sql`insert into tm_chronicle (tree,sighting,kind,text,weather,player) values (${treeId},${sid},'moment',${clip(a.moment, 600)},${J(weather)},${player})`;
    // the Momo asks for help when Argon saw litter around its tree (one open request per tree)
    const ask = clip(a?.momo?.cleanup_ask, 400).trim();
    if (ask && a?.litter?.present && !a.litter.unsafe && !(await openQuest(treeId)))
      await sql`insert into tm_quests (tree,ask,litter,before_sighting,before_path,created_by) values (${treeId},${ask},${J(a.litter)},${sid},${vp},${player}) on conflict do nothing`;
    const quest = await openQuest(treeId);
    const gift = giftPublic(await openGift(treeId), true);
    const family = await (treeRow ? familyOf(treeId) : assignFamily(treeId)).catch((e) => { console.error("family", e); return null; });
    const [tr] = await sql`select visits from tm_trees where id=${treeId}`;
    return [200, { family, gift, quest, report: a?.litter?.unsafe ? ask || null : null, sighting: sid, tree: { id: treeId, visits: tr?.visits ?? 1, ...a.tree }, momo, placement, sponsor, place, weather, moment: a.moment ?? null, returning: !!resident, chronicle: await chronicle(treeId) }];
  }
  if (path === "/fit" && req.method === "POST") {
    if (!isUuid(body.sighting)) return [403, { error: "not yours" }];
    const [s] = await sql`select id,player,placement,critiques,momo from tm_sightings where id=${body.sighting}`;
    if (!s || s.player !== player) return [403, { error: "not yours" }];
    const img = String(body.image ?? "").replace(/^data:image\/\w+;base64,/, "");
    if (img.length < 1000 || img.length > 3_000_000) return [400, { error: "bad image" }];
    const f = await argon([{ inline_data: { mime_type: "image/jpeg", data: img } }, { text: `Momo: ${s.momo?.name}. Hideout: ${s.placement?.why}. Current placement: ${JSON.stringify({ x: s.placement.x, y: s.placement.y, size: s.placement.size })}` }], FIT, 800, "low");
    const p = { ...s.placement, x: Math.min(0.95, Math.max(0.05, Number(f.x) || s.placement.x)), y: Math.min(0.95, Math.max(0.05, Number(f.y) || s.placement.y)), size: Math.min(0.4, Math.max(0.06, Number(f.size) || s.placement.size)), flip: !!f.flip };
    const crit = [...(s.critiques ?? []), { ok: !!f.ok, note: clip(f.note, 300), at: new Date().toISOString() }];
    await sql`update tm_sightings set placement=${J(p)}, critiques=${J(crit)} where id=${s.id}`;
    return [200, { ok: !!f.ok, note: f.note, placement: p }];
  }
  if (path === "/chronicle") {
    const tree = url.searchParams.get("tree");
    return [200, { chronicle: isUuid(tree) ? await chronicle(tree) : [] }];
  }
  if (path === "/cleanup" && req.method === "POST") {
    // after clip of a cleanup: Argon compares it with the before clip the Momo asked from
    if (player.length < 16) return [401, { error: "no player" }];
    if (!isUuid(body.quest)) return [404, { error: "no such request" }];
    const [q] = await sql`select q.*, t.lat tlat, t.lng tlng, t.momo->>'name' momo_name from tm_quests q join tm_trees t on t.id=q.tree where q.id=${body.quest}`;
    if (!q) return [404, { error: "no such request" }];
    if (q.status !== "open") return [409, { error: "This spot was already cleaned up. Thank you for coming!" }];
    const vp = clip(body.path, 120);
    if (!vp.startsWith(player.slice(0, 16) + "/") || vp === q.before_path) return [403, { error: "not your video" }];
    const lat = Number(body.lat), lng = Number(body.lng);
    if (body.lat == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return [400, { error: "Turn on location so the Momo knows you're at its tree." }];
    if (q.tlat != null && meters({ lat, lng }, { lat: q.tlat, lng: q.tlng }) > 40) return [403, { error: "You need to be at the tree to film the after clip." }];
    let before, after;
    try { [[before], [after]] = await Promise.all([bucket.file(q.before_path).download(), bucket.file(vp).download()]); } catch { return [404, { error: "video missing" }]; }
    const [ua, ub] = await Promise.all([toGemini(before, mimeOf(q.before_path)), toGemini(after, mimeOf(vp))]);
    const v = await argon([{ text: "Video A (BEFORE):" }, { file_data: { mime_type: mimeOf(q.before_path), file_uri: ua } }, { text: "Video B (AFTER):" }, { file_data: { mime_type: mimeOf(vp), file_uri: ub } },
      { text: `The Momo is ${q.momo_name}. What it asked for: ${q.ask}\nLitter seen before: ${JSON.stringify(q.litter?.items ?? [])}` }], CLEAN, 2500, "low");
    const pass = !!(v?.same_place && v?.fresh && v?.cleaner && Number(v?.confidence) >= 0.6);
    await sql`update tm_quests set attempts=attempts+1, verdict=${J({ ...v, pass, at: new Date().toISOString(), player })} where id=${q.id}`;
    if (!pass) return [200, { ok: false, note: clip(v?.note, 300) || "Argon couldn't see the difference yet.", remaining: v?.remaining ?? [] }];
    const [done] = await sql`update tm_quests set status='done', done_by=${player}, done_at=now(), after_path=${vp} where id=${q.id} and status='open' returning id`;
    if (!done) return [409, { error: "Someone just finished this one. Thank you for coming!" }];
    await sql`insert into tm_chronicle (tree,kind,text,player,verified) values (${q.tree},'cleanup',${clip(v.chronicle, 400) || "Someone cleaned up around this tree."},${player},true)`;
    let st = await standing(player), earned = false;
    if (st.cleaned_trees >= BADGE.need && !st.badge.have) { await sql`insert into tm_badges (player,badge) values (${player},${BADGE.id}) on conflict do nothing`; earned = true; st = await standing(player); }
    return [200, { ok: true, thanks: clip(v.thanks, 400), removed: v.removed ?? [], remaining: v.remaining ?? [], note: clip(v.note, 300), earned, ...st }];
  }
  if (path === "/hug" && req.method === "POST") {
    // a hug, filmed by the player or a friend; Argon checks it, then the clip is deleted (it shows a person)
    if (player.length < 16) return [401, { error: "no player" }];
    if (!isUuid(body.tree)) return [404, { error: "no such tree" }];
    const vp = clip(body.path, 120);
    if (!vp.startsWith(player.slice(0, 16) + "/")) return [403, { error: "not your video" }];
    const drop = () => bucket.file(vp).delete().catch(() => {});
    const [t] = await sql`select id,lat,lng,species,health,momo->>'name' momo_name from tm_trees where id=${body.tree}`;
    if (!t) { drop(); return [404, { error: "no such tree" }]; }
    const lat = Number(body.lat), lng = Number(body.lng);
    if (body.lat == null || !Number.isFinite(lat) || !Number.isFinite(lng)) { drop(); return [400, { error: "Turn on location so the Momo knows you're at its tree." }]; }
    if (t.lat != null && meters({ lat, lng }, { lat: t.lat, lng: t.lng }) > 40) { drop(); return [403, { error: "You need to be at the tree to hug it." }]; }
    const [{ recent }] = await sql`select count(*)::int recent from tm_hugs where player=${player} and tree=${t.id} and at > now() - interval '20 hours'`;
    if (recent) { drop(); return [429, { error: `${t.momo_name} already got your hug today. Come back tomorrow, or go hug another tree.` }]; }
    let bytes;
    try { [bytes] = await bucket.file(vp).download(); } catch { return [404, { error: "video missing" }]; }
    const uri = await toGemini(bytes, mimeOf(vp));
    const v = await argon([{ file_data: { mime_type: mimeOf(vp), file_uri: uri } }, { text: `The tree on record: ${t.species ?? "unknown species"}, about ${t.health?.height_m ?? "?"} m tall${t.health?.observations?.length ? "; seen before: " + t.health.observations.slice(0, 3).join("; ") : ""}. Its Momo is ${t.momo_name}.` }], HUG, 1500, "low");
    drop();
    const pass = !!(v?.hug && v?.same_tree && v?.fresh && Number(v?.confidence) >= 0.6);
    if (!pass) return [200, { ok: false, note: clip(v?.note, 300) || "Argon couldn't see a hug in that one." }];
    await sql`insert into tm_hugs (tree,player,verdict) values (${t.id},${player},${J({ confidence: v.confidence, note: clip(v.note, 300) })})`;
    await sql`insert into tm_chronicle (tree,kind,text,player,verified) values (${t.id},'hug',${clip(v.chronicle, 400) || "Someone hugged this tree."},${player},true)`;
    let st = await standing(player), earned = false;
    if (st.hugs >= HUGGER.need && !st.hugger.have) { await sql`insert into tm_badges (player,badge) values (${player},${HUGGER.id}) on conflict do nothing`; earned = true; st = await standing(player); }
    return [200, { ok: true, thanks: clip(v.thanks, 400), note: clip(v.note, 300), earned, momo: t.momo_name, ...st }];
  }
  if (path === "/auth/google" && req.method === "POST") {
    // Sign in with Google: verify the ID token, then tie this device's progress to the account.
    if (player.length < 16) return [401, { error: "no player" }];
    let p;
    try { p = (await oauth.verifyIdToken({ idToken: String(body.credential ?? ""), audience: CLIENT_ID })).getPayload(); } catch { return [401, { error: "Google sign-in didn't verify. Try again." }]; }
    if (!p?.sub || !p.email_verified) return [401, { error: "Google account email isn't verified." }];
    const [other] = await sql`select google_sub from tm_users where primary_player=${player}`;
    if (other && other.google_sub !== p.sub) return [409, { error: "This phone is signed in to another account. Sign out first.", signout: true }];
    const [u] = await sql`insert into tm_users (google_sub,email,name,picture,primary_player) values (${p.sub},${p.email},${clip(p.name, 80) || null},${p.picture ?? null},${player})
      on conflict (google_sub) do update set email=excluded.email, name=excluded.name, picture=excluded.picture, last_seen=now() returning *`;
    const main = u.primary_player;
    if (main !== player) {
      // this device played anonymously before signing in: fold its Momos, cleanups, hugs and badges into the account
      await sql.begin(async (tx) => {
        await tx`update tm_sightings set player=${main} where player=${player}`;
        await tx`update tm_chronicle set player=${main} where player=${player}`;
        await tx`update tm_quests set done_by=${main} where done_by=${player}`;
        await tx`update tm_quests set created_by=${main} where created_by=${player}`;
        await tx`update tm_hugs set player=${main} where player=${player}`;
        await tx`update tm_gifts set giver=${main} where giver=${player}`;
        await tx`update tm_gifts set claimed_by=${main} where claimed_by=${player}`;
        await tx`insert into tm_badges (player,badge,at) select ${main},badge,at from tm_badges where player=${player} on conflict do nothing`;
        await tx`delete from tm_badges where player=${player}`;
      });
    }
    await sql`insert into tm_links (player,user_id) values (${player},${u.id}) on conflict (player) do nothing`;
    let st = await standing(main);
    if (st.cleaned_trees >= BADGE.need && !st.badge.have) await sql`insert into tm_badges (player,badge) values (${main},${BADGE.id}) on conflict do nothing`;
    if (st.hugs >= HUGGER.need && !st.hugger.have) await sql`insert into tm_badges (player,badge) values (${main},${HUGGER.id}) on conflict do nothing`;
    st = await standing(main);
    return [200, { player: main, merged: main !== player, ...st }];
  }
  if (path === "/gift" && req.method === "POST") {
    // leave a gift: a poem plus a code, for the first person who reads the poem aloud at this tree
    const u = await userOf(player);
    if (!u) return [401, { error: "Sign in with Google to leave a gift.", signin: true }];
    if (!isUuid(body.tree)) return [404, { error: "no such tree" }];
    const [t] = await sql`select id, momo->>'name' momo_name from tm_trees where id=${body.tree}`;
    if (!t) return [404, { error: "no such tree" }];
    const poem = clip(body.poem, 800).trim(), title = clip(body.title, 80).trim(), code = clip(body.code, 80).trim(), how = clip(body.how, 240).trim(), from = clip(body.from, 40).trim() || null;
    if (poem.split(/\s+/).length < 6) return [400, { error: "Write a poem of at least a few lines." }];
    if (!title || !code) return [400, { error: "Say what the gift is and give the code." }];
    if (await openGift(t.id)) return [409, { error: `${t.momo_name} is already holding a gift. Leave yours in another tree.` }];
    const ok = await argon([{ text: JSON.stringify({ poem, gift: title, how_to_use: how, from }) }], MOD, 200, "low").catch(() => ({ ok: false, reason: "couldn't check it right now" }));
    if (!ok?.ok) return [422, { error: ok?.reason || "That gift can't be posted." }];
    const [g] = await sql`insert into tm_gifts (tree,giver,giver_user,from_name,poem,title,code,how) values (${t.id},${player},${u.id},${from},${poem},${title},${code},${how || null}) on conflict do nothing returning id`;
    if (!g) return [409, { error: `${t.momo_name} is already holding a gift. Leave yours in another tree.` }];
    return [200, { id: g.id, momo: t.momo_name }];
  }
  if (path === "/gift" && req.method === "GET") {
    // the poem only shows up when you're standing at the tree
    const id = url.searchParams.get("id");
    if (!isUuid(id)) return [404, { error: "no such gift" }];
    const [g] = await sql`select g.*, t.lat tlat, t.lng tlng, t.momo->>'name' momo_name from tm_gifts g join tm_trees t on t.id=g.tree where g.id=${id}`;
    if (!g || g.status !== "open") return [404, { error: "That gift already found its person." }];
    const lat = Number(url.searchParams.get("lat")), lng = Number(url.searchParams.get("lng"));
    const near = Number.isFinite(lat) && Number.isFinite(lng) && (g.tlat == null || meters({ lat, lng }, { lat: g.tlat, lng: g.tlng }) <= 40);
    return [200, { ...giftPublic(g, near), near, momo: g.momo_name, tree: g.tree }];
  }
  if (path === "/claim" && req.method === "POST") {
    // read the poem aloud at the tree; Argon listens; first verified reader gets the code; the clip is deleted after
    const vp = clip(body.path, 120);
    const mine = player.length >= 16 && vp.startsWith(player.slice(0, 16) + "/");
    const drop = () => mine && bucket.file(vp).delete().catch(() => {});
    const u = await userOf(player);
    if (!u) { drop(); return [401, { error: "Sign in with Google to claim a gift.", signin: true }]; }
    if (!isUuid(body.gift)) { drop(); return [404, { error: "no such gift" }]; }
    if (!vp.startsWith(player.slice(0, 16) + "/")) return [403, { error: "not your video" }];
    const [g] = await sql`select g.*, t.lat tlat, t.lng tlng, t.species, t.momo->>'name' momo_name from tm_gifts g join tm_trees t on t.id=g.tree where g.id=${body.gift}`;
    if (!g || g.status !== "open") { drop(); return [409, { error: "Someone got here first. That gift already found its person." }]; }
    if (g.giver_user === u.id) { drop(); return [403, { error: "That's your own gift. Leave it for someone else to find." }]; }
    const lat = Number(body.lat), lng = Number(body.lng);
    if (body.lat == null || !Number.isFinite(lat) || !Number.isFinite(lng)) { drop(); return [400, { error: "Turn on location so the Momo knows you're at its tree." }]; }
    if (g.tlat != null && meters({ lat, lng }, { lat: g.tlat, lng: g.tlng }) > 40) { drop(); return [403, { error: "Read it at the tree. You need to be there." }]; }
    let bytes;
    try { [bytes] = await bucket.file(vp).download(); } catch { return [404, { error: "video missing" }]; }
    const uri = await toGemini(bytes, mimeOf(vp));
    const v = await argon([{ file_data: { mime_type: mimeOf(vp), file_uri: uri } }, { text: `The tree on record: ${g.species ?? "unknown species"}. Its Momo is ${g.momo_name}.` }], READ, 2500, "low");
    drop();
    const cov = Math.round(coverage(g.poem, v?.transcript) * 100) / 100;
    const pass = !!(v?.has_speech && v?.live_voice && v?.at_tree && v?.fresh && cov >= 0.7 && Number(v?.confidence) >= 0.6);
    await sql`update tm_gifts set attempts=attempts+1 where id=${g.id}`;
    if (!pass) return [200, { ok: false, coverage: cov, note: !v?.has_speech ? "The Momo couldn't hear anyone reading. Read it out loud, close to the phone." : !v?.live_voice ? "That didn't sound like a live voice. Read it yourself, out loud." : !v?.at_tree ? "Keep the tree in the shot while you read." : cov < 0.7 ? `The Momo heard about ${Math.round(cov * 100)}% of the poem. Read all of it.` : clip(v?.note, 300) || "Try once more." }];
    const [won] = await sql`update tm_gifts set status='claimed', claimed_by=${player}, claimed_user=${u.id}, claimed_at=now(), verdict=${J({ coverage: cov, confidence: v.confidence, transcript: clip(v.transcript, 1200) })} where id=${g.id} and status='open' returning id`;
    if (!won) return [409, { error: "Someone got here first, just now. That gift found its person." }];
    await sql`insert into tm_chronicle (tree,kind,text,player,verified) values (${g.tree},'gift',${clip(v.chronicle, 400) || "A poem was read aloud here, and a gift found its person."},${player},true)`;
    return [200, { ok: true, title: g.title, code: g.code, how: g.how, from: g.from_name, poem: g.poem, momo: g.momo_name, momo_line: clip(v.momo_line, 400) }];
  }
  if (path === "/gifts") {
    // your gifts: the ones you found (with codes) and the ones you left (with whether they've been found)
    const got = await sql`select g.title,g.code,g.how,g.from_name,g.claimed_at,t.momo->>'name' momo from tm_gifts g join tm_trees t on t.id=g.tree where g.claimed_by=${player} order by g.claimed_at desc`;
    const left = await sql`select g.title,g.status,g.created_at,g.claimed_at,t.momo->>'name' momo from tm_gifts g join tm_trees t on t.id=g.tree where g.giver=${player} order by g.created_at desc`;
    return [200, { got, left }];
  }
  if (path === "/stats") {
    const [r] = await sql`select (select count(*)::int from tm_users) users, (select count(*)::int from tm_trees) trees, (select count(*)::int from tm_sightings) sightings,
      (select count(*)::int from tm_quests where status='done') cleanups, (select count(*)::int from tm_hugs) hugs,
      (select count(*)::int from tm_gifts) gifts, (select count(*)::int from tm_gifts where status='claimed') gifts_found`;
    return [200, r];
  }
  if (path === "/me") return [200, await standing(player)];
  if (path === "/trees") {
    // every Momo on the map: where it was found, what it is, how often it's been seen
    const rows = await sql`select t.id,t.lat,t.lng,t.species,t.visits,t.last_seen,t.place,t.momo->>'name' name,t.momo->>'rarity' rarity,t.momo->>'line' line,t.momo->>'svg' svg,t.momo->>'place_note' place_note,t.health->>'health_label' health,
      (select text from tm_chronicle c where c.tree=t.id and c.kind='moment' order by at desc limit 1) moment,
      (select json_build_object('id',q.id,'ask',q.ask) from tm_quests q where q.tree=t.id and q.status='open' limit 1) quest,
      (select json_build_object('id',g.id,'title',g.title,'from',g.from_name) from tm_gifts g where g.tree=t.id and g.status='open' limit 1) gift,
      (select json_build_object('id',f.id,'name',f.name,'size',(select count(*) from tm_trees x where x.family=f.id)) from tm_families f where f.id=t.family) family
      from tm_trees t where t.lat is not null and t.momo is not null order by t.last_seen desc limit 500`;
    return [200, { trees: rows }];
  }
  if (path === "/memory" && req.method === "POST") {
    if (!isUuid(body.sighting)) return [403, { error: "not yours" }];
    const [s] = await sql`select id,tree,player from tm_sightings where id=${body.sighting}`;
    if (!s || s.player !== player) return [403, { error: "not yours" }];
    const text = clip(body.text, 280).trim(), author = clip(body.author, 40).trim() || null;
    if (text.length < 2) return [400, { error: "write something" }];
    const [{ n }] = await sql`select count(*)::int n from tm_chronicle where sighting=${s.id} and kind='memory'`;
    if (n >= 1) return [409, { error: "one memory per discovery" }];
    const ok = await argon([{ text: JSON.stringify({ text, author }) }], MOD, 200, "low").catch(() => ({ ok: false, reason: "couldn't check it right now" }));
    if (!ok?.ok) return [422, { error: ok?.reason || "That note can't be posted." }];
    await sql`insert into tm_chronicle (tree,sighting,kind,text,author,player) values (${s.tree},${s.id},'memory',${text},${author},${player})`;
    return [200, { chronicle: await chronicle(s.tree) }];
  }
  if (path === "/keep" && req.method === "POST") {
    if (!isUuid(body.sighting)) return [403, { error: "not yours" }];
    const status = body.action === "capture" ? (Math.random() < 0.8 ? "captured" : "escaped") : "documented";
    const [d] = await sql`update tm_sightings set status=${status} where id=${body.sighting} and player=${player} returning id,status`;
    return d ? [200, d] : [403, { error: "not yours" }];
  }
  if (path === "/family") {
    const id = url.searchParams.get("tree");
    return [200, { family: isUuid(id) ? await familyOf(id) : null }];
  }
  if (path === "/admin/families" && req.method === "POST") {
    // one-off backfill: group existing trees into families (oldest first)
    if (!process.env.DB_PASSWORD || req.headers["x-tm-admin"] !== process.env.DB_PASSWORD) return [403, { error: "no" }];
    const all = await sql`select id from tm_trees where momo is not null and family is null order by first_seen`;
    for (const t of all) await assignFamily(t.id);
    return [200, { families: await sql`select f.name, f.species, (select json_agg(momo->>'name') from tm_trees x where x.family=f.id) members from tm_families f` }];
  }
  if (path === "/journal") {
    const rows = await sql`select s.id,s.momo,s.analysis,s.status,s.created_at,s.tree,s.sponsor,f.name family from tm_sightings s left join tm_trees t on t.id=s.tree left join tm_families f on f.id=t.family where s.player=${player} and s.status<>'new' order by s.created_at desc limit 50`;
    return [200, { entries: rows.map((e) => ({ id: e.id, status: e.status, at: e.created_at, tree: e.tree, momo: { name: e.momo?.name, rarity: e.momo?.rarity, line: e.momo?.line, svg: e.momo?.svg }, species: e.analysis?.tree?.species, health: e.analysis?.tree?.health_label, sponsor: e.sponsor, family: e.family })) }];
  }
  if (path === "/sponsor" && req.method === "POST") {
    if (player.length < 16) return [401, { error: "no player" }];
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [400, { error: "need location" }];
    const [d] = await sql`insert into tm_sponsors (name,offer,lat,lng,radius_m,demo) values (${clip(body.name, 60) || "Demo Pizza Co."},${clip(body.offer, 120) || "2 for 1 slices today"},${lat},${lng},500,true) returning id`;
    return [200, { id: d?.id }];
  }
  return [404, { error: "not found", path }];
}

http.createServer(async (req, res) => {
  const send = (s, b) => { res.writeHead(s, { ...CORS, "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/^.*\/treemomo/, "") || "/";
  const player = clip(req.headers["x-tm-player"], 64);
  try {
    let body = {};
    if (req.method === "POST") {
      const chunks = []; let n = 0;
      for await (const c of req) { n += c.length; if (n > 4_000_000) return send(413, { error: "too big" }); chunks.push(c); }
      try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch {}
    }
    const [s, b] = await route(req, url, path, player, body);
    send(s, b);
  } catch (e) {
    console.error(e);
    send(500, { error: String(e?.message ?? e) });
  }
}).listen(Number(process.env.PORT) || 8080, () => console.log("treemomo api up"));

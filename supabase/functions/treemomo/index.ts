// TreeMomo API. Film a tree -> Argon watches the clip: tree species and health,
// the best hideout (time + spot), and a Momo born from that tree. Then a
// render -> watch -> fix pass on the composite. Players are anonymous tokens.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODEL = Deno.env.get("TM_ARGON_MODEL") ?? "gemini-4-argon";
const G = "https://generativelanguage.googleapis.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-tm-player", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });
const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

async function argon(parts: unknown[], system: string, maxTokens = 6000, think = "low"): Promise<any> {
  const body = (t: boolean) => JSON.stringify({
    systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.8, responseMimeType: "application/json", ...(t ? { thinkingConfig: { thinkingLevel: think, includeThoughts: false } } : {}) },
  });
  const url = `${G}/v1beta/models/${MODEL}:generateContent`, h = { "content-type": "application/json", "x-goog-api-key": KEY };
  let r = await fetch(url, { method: "POST", headers: h, body: body(true) });
  if (r.status === 400) r = await fetch(url, { method: "POST", headers: h, body: body(false) });
  if (!r.ok) throw new Error(`argon ${r.status}: ${clip(await r.text(), 200)}`);
  const j = await r.json();
  const txt = (j.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("");
  return JSON.parse(txt.replace(/^```json\s*|```$/g, ""));
}

async function toGemini(bytes: Uint8Array, mime: string): Promise<string> {
  const start = await fetch(`${G}/upload/v1beta/files`, { method: "POST", headers: { "x-goog-api-key": KEY, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
    "X-Goog-Upload-Header-Content-Length": String(bytes.length), "X-Goog-Upload-Header-Content-Type": mime, "content-type": "application/json" }, body: JSON.stringify({ file: { display_name: "tree" } }) });
  if (!start.ok) throw new Error(`upload start ${start.status}`);
  const up = await fetch(start.headers.get("x-goog-upload-url")!, { method: "POST", headers: { "Content-Length": String(bytes.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: bytes as unknown as BodyInit });
  let f = (await up.json()).file;
  for (let i = 0; i < 60 && f?.state === "PROCESSING"; i++) { await new Promise((r) => setTimeout(r, 1500)); f = await (await fetch(`${G}/v1beta/${f.name}`, { headers: { "x-goog-api-key": KEY } })).json(); }
  if (f?.state !== "ACTIVE") throw new Error(`video not ready: ${f?.state}`);
  return f.uri;
}

const SAFE_TAGS = /^(g|path|circle|ellipse|rect|polygon|polyline|line)$/;
function sanitize(svg: string): string | null {
  const s = String(svg ?? "").replace(/<\/?svg[^>]*>/g, "").trim();
  if (!s || s.length > 9000 || /script|on[a-z]+\s*=|href|url\(|<!|foreignObject|<image|<use|style\s*=/i.test(s)) return null;
  return [...s.matchAll(/<\/?\s*([a-zA-Z]+)/g)].every((m) => SAFE_TAGS.test(m[1])) ? s : null;
}

const WATCH = `You are the field naturalist and creature designer for TreeMomo, a game where players film real trees and find small magical creatures (Momos) hiding in them. The player just filmed this tree. Watch the whole clip.
1) The tree: first say whether a real, living or dead tree is actually the subject of the clip (is_tree). If not, set is_tree false and keep the rest minimal. Otherwise identify species (common + scientific, honest confidence), estimate height, and observe health the way a careful arborist would from video only: canopy density and color, dieback, broken or hanging limbs, wounds, cavities, fungus or conks, bark damage, lean, root flare and soil around it, signs of pests. Say what you can't see. This is an observation, not a diagnosis.
2) The hideout: pick the single best spot in the clip where a small creature could believably hide (a fork, hollow, knot, behind a branch, among leaves). Give the timestamp in seconds where it is clearest, and its position in that frame as fractions of width and height (0 to 1, from the top-left), plus how big the Momo should appear (fraction of frame height, 0.08 to 0.35), and whether it should peek from behind something (which side).
3) The Momo: a small, charming creature born from THIS tree (a fig makes a FiggyMomo, an oak an OakMomo). Its full name is a first name that belongs to the place it was found, then its tree-line name, like "Willow FiggyMomo" or "Mission OakMomo": the first name should help the player remember WHERE they found it, so draw it from the geographic or cultural area given below: the neighborhood or city name, a landmark, river, hill or street, the area's history, its languages and the people who shaped it (including Indigenous place names where fitting), its food, music or local character. Prefer what a local would recognize and smile at. Respectful, never a stereotype or a joke at a culture's expense. If only the city or region is known, use that; if no place is known, use the landscape you see. Give: name (the full name), first_name, place_note (one short line on what the first name refers to, so the player learns something about the area), species line, temperament, a one-line lore that mentions something you actually saw in the tree, a rarity based on how unusual or old the tree is, and a front-facing cartoon SVG of it for a 200x200 frame, centered, transparent background, thick dark outlines (#1d1a17, width 3), flat fills drawn from the tree's real colors (bark, leaves, fruit, flowers). Big eyes. Allowed elements: g, path, circle, ellipse, rect, polygon, polyline, line. No text, no style attribute, no scripts. Under 6000 characters. If the tree looks unwell, the Momo can look a little tired; healthy trees make bright Momos.
4) The moment: this tree keeps a chronicle, one entry per discovery. Write one or two sentences for it about this exact moment: the light, the season, what's moving, the sounds, what's happening around the tree, woven with the weather given below. Concrete and a little poetic; never describe identifiable people.
If the tree already has a resident Momo (given below), don't design a new one: return momo.name exactly as given, leave momo.svg empty, and give momo.mood (how it seems today, one short phrase).
Reply JSON only:
{"moment": "...", "tree": {"is_tree": true, "match": null, "species": "...", "scientific": "...", "confidence": 0.0, "height_m": 0, "health_score": 0-100, "health_label": "thriving|healthy|stressed|declining|hazard", "observations": ["..."], "cant_see": "...", "care_tip": "one practical sentence"}, "hideout": {"t": 0.0, "x": 0.5, "y": 0.5, "size": 0.18, "peek": "left|right|top|none", "why": "..."}, "momo": {"name": "First LineName", "first_name": "...", "place_note": "...", "line": "...", "temperament": "...", "rarity": "common|uncommon|rare|legendary", "lore": "...", "mood": "...", "svg": "<g>...</g>"}}`;

const FIT = `You are checking a composite for TreeMomo: a cartoon Momo has been placed into a frame of the player's real tree video. The goal: it should look like it is really sitting in the hideout described (on the branch or in the fork, not floating in the sky or pasted over the trunk), at a believable size for a small creature, and readable on a phone.
Look at the composite and correct the placement. Give the new center (fractions of width/height), size (fraction of frame height), and a short note on what you fixed. If it already works, return the same values with ok true.
Reply JSON only: {"ok": true|false, "x": 0.5, "y": 0.5, "size": 0.18, "flip": false, "note": "..."}`;

// Neighborhood / city for the Momo's first name (OpenStreetMap Nominatim, polite: one call per sighting).
async function placeName(lat: number, lng: number) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${lat}&lon=${lng}`, { headers: { "User-Agent": "TreeMomo/0.1 (treemomo.vercel.app)", "Accept-Language": "en" }, signal: AbortSignal.timeout(3500) });
    const a = (await r.json())?.address ?? {};
    return { neighborhood: a.neighbourhood ?? a.suburb ?? a.quarter ?? a.hamlet ?? null, city: a.city ?? a.town ?? a.village ?? a.county ?? null, state: a.state ?? null };
  } catch { return null; }
}

const WMO: Record<number, string> = { 0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "rain showers", 81: "rain showers", 82: "violent rain showers", 85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail" };
async function weatherAt(lat: number, lng: number) {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day,relative_humidity_2m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`, { signal: AbortSignal.timeout(3500) });
    const c = (await r.json())?.current; if (!c) return null;
    return { temp_f: Math.round(c.temperature_2m), feels_f: Math.round(c.apparent_temperature), sky: WMO[c.weather_code] ?? "unknown", wind_mph: Math.round(c.wind_speed_10m), humidity: c.relative_humidity_2m, day: !!c.is_day, local_time: c.time };
  } catch { return null; }
}

async function chronicle(tree: string) {
  const { data } = await db.from("tm_chronicle").select("kind,text,author,weather,verified,at").eq("tree", tree).order("at", { ascending: false }).limit(40);
  return data ?? [];
}
const MOD = `You check notes that players leave on a tree in a public, all-ages location game. Allow memories, kind words, local history, jokes, poems. Reject: anything hateful, sexual, threatening or harassing; personal information (phone numbers, addresses, full names of private people, emails); links or ads; anything that tells people to do something unsafe. Reply JSON only: {"ok": true|false, "reason": "short, friendly, only if rejected"}`;

function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/treemomo/, "") || "/";
  const player = clip(req.headers.get("x-tm-player"), 64);
  try {
    if (path === "/upload-url" && req.method === "POST") {
      if (player.length < 16) return json({ error: "no player" }, 401);
      const b = await req.json().catch(() => ({}));
      const ext = /^(mp4|mov|webm|m4v|3gp)$/i.test(b.ext) ? b.ext.toLowerCase() : "mp4";
      const p = `${player.slice(0, 16)}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await db.storage.from("tm").createSignedUploadUrl(p);
      if (error) return json({ error: error.message }, 500);
      return json({ path: p, url: data.signedUrl });
    }
    if (path === "/analyze" && req.method === "POST") {
      if (player.length < 16) return json({ error: "no player" }, 401);
      const b = await req.json().catch(() => ({}));
      const vp = clip(b.path, 120);
      if (!vp.startsWith(player.slice(0, 16) + "/")) return json({ error: "not your video" }, 403);
      const { data: blob, error } = await db.storage.from("tm").download(vp);
      if (error || !blob) return json({ error: "video missing" }, 404);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const ext = vp.split(".").pop();
      const mime = ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : ext === "3gp" ? "video/3gpp" : "video/mp4";
      const uri = await toGemini(bytes, mime);
      const lat = Number(b.lat), lng = Number(b.lng), hasLoc = Number.isFinite(lat) && Number.isFinite(lng);
      // nearby known trees (GPS is noisy: 15 m). Argon decides which one, if any, this is, by species and look.
      let cands: any[] = [];
      if (hasLoc) {
        const { data: near } = await db.from("tm_trees").select("id,lat,lng,visits,momo,species,health").gte("lat", lat - 0.0003).lte("lat", lat + 0.0003).gte("lng", lng - 0.0004).lte("lng", lng + 0.0004);
        cands = (near ?? []).map((t) => ({ ...t, d: meters({ lat, lng }, t) })).filter((t) => t.d < 15).sort((x, y) => x.d - y.d).slice(0, 6);
      }
      const [place, weather] = hasLoc ? await Promise.all([placeName(lat, lng), weatherAt(lat, lng)]) : [null, null];
      const where = place ? [place.neighborhood, place.city, place.state].filter(Boolean).join(", ") : "";
      const known = cands.map((t, i) => `T${i + 1}: ${t.species ?? "unknown species"}, ~${Math.round(t.d)} m away, height ~${t.health?.height_m ?? "?"} m${t.momo ? `, resident Momo ${t.momo.name}` : ""}`);
      const ctx = [`The player is at ${hasLoc ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : "an unknown location"}${where ? ` (${where})` : ""}.`,
        weather ? `Weather right now: ${weather.sky}, ${weather.temp_f}°F (feels ${weather.feels_f}°F), wind ${weather.wind_mph} mph, humidity ${weather.humidity}%, ${weather.day ? "daytime" : "night"}, local time ${weather.local_time}.` : "",
        known.length ? `Trees already known within 15 m of the player (GPS is approximate, and different trees often stand close together):\n${known.join("\n")}\nSet tree.match to the key (like "T1") ONLY if the tree in this clip is that same individual tree: same species, matching size and look. A different species is never a match. Otherwise null. If you match one that has a resident Momo, don't design a new Momo: return momo.name exactly as the resident's, leave momo.svg empty and give momo.mood.` : "No trees are known near here yet: this tree has no Momo, so you are designing its first and only resident.",
        b.note ? "They said: " + clip(b.note, 200) : ""].filter(Boolean).join("\n");
      const a = await argon([{ file_data: { mime_type: mime, file_uri: uri } }, { text: ctx }], WATCH, 9000, "low");
      if (a?.tree?.is_tree === false) return json({ error: "No tree in that clip. Film a real tree: trunk, branches and leaves, about 10 seconds." }, 422);
      // accept Argon's match only if the species agree too
      const norm = (x: unknown) => String(x ?? "").toLowerCase().replace(/crepe/g, "crape").replace(/grey/g, "gray").replace(/\(.*?\)|'.*?'/g, "").replace(/[^a-z ]/g, " ").trim().split(/\s+/).filter((w) => w.length > 2 && !["tree", "common"].includes(w));
      const sameSpecies = (x: unknown, y: unknown) => { const A = norm(x), B = norm(y); return A.length > 0 && B.length > 0 && A[A.length - 1] === B[B.length - 1] && (A.length < 2 || B.length < 2 || A.join(" ") === B.join(" ") || A.slice(-2).join(" ") === B.slice(-2).join(" ")); };
      const mi = /^T(\d+)$/.exec(String(a?.tree?.match ?? ""));
      const cand = mi ? cands[Number(mi[1]) - 1] : null;
      const treeRow = cand && sameSpecies(cand.species, a?.tree?.species) ? cand : null;
      const resident = treeRow?.momo ?? null;
      const fresh = sanitize(a?.momo?.svg);
      const momo = resident ? { ...resident, mood: clip(a?.momo?.mood, 80) || null } : { ...a.momo, svg: fresh ?? `<circle cx="100" cy="110" r="60" fill="#8fbf6a" stroke="#1d1a17" stroke-width="3"/><circle cx="80" cy="100" r="12" fill="#fff" stroke="#1d1a17" stroke-width="3"/><circle cx="120" cy="100" r="12" fill="#fff" stroke="#1d1a17" stroke-width="3"/><circle cx="82" cy="102" r="5" fill="#1d1a17"/><circle cx="122" cy="102" r="5" fill="#1d1a17"/>` };
      const hide = a.hideout ?? {};
      const placement = { t: Math.max(0, Number(hide.t) || 0), x: Math.min(0.95, Math.max(0.05, Number(hide.x) || 0.5)), y: Math.min(0.95, Math.max(0.05, Number(hide.y) || 0.5)), size: Math.min(0.4, Math.max(0.06, Number(hide.size) || 0.18)), peek: hide.peek ?? "none", why: clip(hide.why, 300), flip: false };
      let treeId: string;
      if (treeRow) {
        treeId = treeRow.id;
        await db.from("tm_trees").update({ visits: treeRow.visits + 1, last_seen: new Date().toISOString(), health: a.tree, ...(treeRow.momo ? {} : { momo }), ...(place ? { place } : {}) }).eq("id", treeId);
      } else {
        const { data: t } = await db.from("tm_trees").insert({ lat: hasLoc ? lat : null, lng: hasLoc ? lng : null, accuracy_m: Number(b.acc) || null, species: a.tree?.species, species_confidence: a.tree?.confidence, health: a.tree, momo, place }).select("id").single();
        treeId = t!.id;
      }
      let sponsor = null;
      if (hasLoc) {
        const { data: sp } = await db.from("tm_sponsors").select("id,name,offer,lat,lng,radius_m,demo").eq("active", true).gte("lat", lat - 0.02).lte("lat", lat + 0.02);
        const s = (sp ?? []).map((x) => ({ ...x, d: Math.round(meters({ lat, lng }, x)) })).filter((x) => x.d <= x.radius_m).sort((x, y) => x.d - y.d)[0];
        if (s) sponsor = { name: s.name, offer: s.offer, distance_m: s.d, demo: s.demo };
      }
      const { data: s } = await db.from("tm_sightings").insert({ tree: treeId, player, video_path: vp, analysis: a, momo, placement, sponsor }).select("id").single();
      if (a.moment) await db.from("tm_chronicle").insert({ tree: treeId, sighting: s!.id, kind: "moment", text: clip(a.moment, 600), weather, player });
      const { data: tr } = await db.from("tm_trees").select("visits").eq("id", treeId).single();
      return json({ sighting: s!.id, tree: { id: treeId, visits: tr?.visits ?? 1, ...a.tree }, momo, placement, sponsor, place, weather, moment: a.moment ?? null, returning: !!resident, chronicle: await chronicle(treeId) });
    }
    if (path === "/fit" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const { data: s } = await db.from("tm_sightings").select("id,player,placement,critiques,momo").eq("id", clip(b.sighting, 40)).maybeSingle();
      if (!s || s.player !== player) return json({ error: "not yours" }, 403);
      const img = String(b.image ?? "").replace(/^data:image\/\w+;base64,/, "");
      if (img.length < 1000 || img.length > 3_000_000) return json({ error: "bad image" }, 400);
      const f = await argon([{ inline_data: { mime_type: "image/jpeg", data: img } }, { text: `Momo: ${s.momo?.name}. Hideout: ${s.placement?.why}. Current placement: ${JSON.stringify({ x: s.placement.x, y: s.placement.y, size: s.placement.size })}` }], FIT, 800, "low");
      const p = { ...s.placement, x: Math.min(0.95, Math.max(0.05, Number(f.x) || s.placement.x)), y: Math.min(0.95, Math.max(0.05, Number(f.y) || s.placement.y)), size: Math.min(0.4, Math.max(0.06, Number(f.size) || s.placement.size)), flip: !!f.flip };
      const crit = [...(s.critiques ?? []), { ok: !!f.ok, note: clip(f.note, 300), at: new Date().toISOString() }];
      await db.from("tm_sightings").update({ placement: p, critiques: crit }).eq("id", s.id);
      return json({ ok: !!f.ok, note: f.note, placement: p });
    }
    if (path === "/chronicle") {
      const tree = clip(url.searchParams.get("tree"), 40);
      return json({ chronicle: await chronicle(tree) });
    }
    if (path === "/memory" && req.method === "POST") {
      // a finder leaves a note for the next person who finds this Momo; checked before it's shown
      const b = await req.json().catch(() => ({}));
      const { data: s } = await db.from("tm_sightings").select("id,tree,player").eq("id", clip(b.sighting, 40)).maybeSingle();
      if (!s || s.player !== player) return json({ error: "not yours" }, 403);
      const text = clip(b.text, 280).trim(), author = clip(b.author, 40).trim() || null;
      if (text.length < 2) return json({ error: "write something" }, 400);
      const { count } = await db.from("tm_chronicle").select("id", { count: "exact", head: true }).eq("sighting", s.id).eq("kind", "memory");
      if ((count ?? 0) >= 1) return json({ error: "one memory per discovery" }, 409);
      const ok = await argon([{ text: JSON.stringify({ text, author }) }], MOD, 200, "low").catch(() => ({ ok: false, reason: "couldn't check it right now" }));
      if (!ok?.ok) return json({ error: ok?.reason || "That note can't be posted." }, 422);
      await db.from("tm_chronicle").insert({ tree: s.tree, sighting: s.id, kind: "memory", text, author, player });
      return json({ chronicle: await chronicle(s.tree) });
    }
    if (path === "/keep" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const status = b.action === "capture" ? (Math.random() < 0.8 ? "captured" : "escaped") : "documented";
      const { data } = await db.from("tm_sightings").update({ status }).eq("id", clip(b.sighting, 40)).eq("player", player).select("id,status").maybeSingle();
      return data ? json(data) : json({ error: "not yours" }, 403);
    }
    if (path === "/journal") {
      const { data } = await db.from("tm_sightings").select("id,momo,analysis,status,created_at,tree,sponsor").eq("player", player).neq("status", "new").order("created_at", { ascending: false }).limit(50);
      return json({ entries: (data ?? []).map((e) => ({ id: e.id, status: e.status, at: e.created_at, tree: e.tree, momo: { name: e.momo?.name, rarity: e.momo?.rarity, line: e.momo?.line, svg: e.momo?.svg }, species: e.analysis?.tree?.species, health: e.analysis?.tree?.health_label, sponsor: e.sponsor })) });
    }
    if (path === "/sponsor" && req.method === "POST") {
      // demo sponsors only, placed by the player for testing: clearly labeled as demo
      const b = await req.json().catch(() => ({}));
      if (player.length < 16) return json({ error: "no player" }, 401);
      const lat = Number(b.lat), lng = Number(b.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: "need location" }, 400);
      const { data } = await db.from("tm_sponsors").insert({ name: clip(b.name, 60) || "Demo Pizza Co.", offer: clip(b.offer, 120) || "2 for 1 slices today", lat, lng, radius_m: 500, demo: true }).select("id").single();
      return json({ id: data?.id });
    }
    return json({ error: "not found", path }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

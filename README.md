# TreeMomo

**Film a real tree. Find the Momo living in it.** Live at [treemomo.com](https://treemomo.com).

TreeMomo is a location game built on Gemini 4 Argon. You film a tree for 10 seconds, and Argon watches the clip. It works out the species and how healthy the tree looks, finds the best hideout in the footage, and designs the tree's one resident Momo from the tree's own colors. The Momo's first name comes from the neighborhood, so people remember the place: Lundy CrapeMomo, Coyote MagnoMomo. Then Argon looks at its own composite and moves the Momo until it really sits in the branch.

Every tree keeps a chronicle. Each time someone finds its Momo, Argon writes the moment with the live weather, and finders can leave memories for the next person.

## Things to do at a tree

| | What you do | How Argon checks it |
|---|---|---|
| 🌳 **Find** | Film the tree | Species, health, hideout, Momo, the moment. Two different species within 10 m are never the same tree |
| 🧹 **Clean up** | The Momo asks for help when Argon sees litter around its tree | Compares the before clip with your after clip: same ground, really cleaner, filmed fresh |
| 🤗 **Hug** | Film yourself or a friend hugging the trunk | A real hug, the right tree. The clip is deleted right after |
| 🎁 **Pay it forward** | Leave a poem and a gift code in a Momo. The first person to read the poem aloud at the tree gets the code | Argon transcribes blind, without seeing the poem; the server matches the words in order. The voice must be live and the tree in shot |

Badges: **Friend of the Tall** for cleaning up around 5 trees, **Tree Hugger** for 10 hugs.

## Built on Google

- **Gemini 4 Argon**: video understanding (tree, health, hideout, Momo design as SVG, the moment), a render → watch → fix placement loop, before/after cleanup checks, hug checks, blind transcription, moderation
- **Cloud Run**: the API (`cloudrun/server.mjs`)
- **Cloud SQL (Postgres 16)**: trees, sightings, chronicle, quests, hugs, gifts, users (`cloudrun/schema.sql`)
- **Cloud Storage**: video uploads through v4 signed URLs
- **Maps JavaScript API**: Momos dance on the map where they were found
- **Geocoding API**: neighborhood names for Momo first names
- **Weather API**: the weather in each moment
- **Sign in with Google**: optional. Progress made before signing in carries over
- **Secret Manager**: Gemini key, server key, DB password

## Layout

```
web/                  the app: one HTML file, plus privacy and terms
cloudrun/server.mjs   the API (Node 22, postgres, @google-cloud/storage)
cloudrun/prompts.mjs  the Argon prompts
cloudrun/schema.sql   the database
```

## Run your own

```bash
gcloud run deploy treemomo-api --source cloudrun --region us-west1 --allow-unauthenticated \
  --add-cloudsql-instances PROJECT:REGION:INSTANCE \
  --set-secrets GEMINI_API_KEY=tm-gemini-key:latest,GOOGLE_SERVER_KEY=tm-server-key:latest,DB_PASSWORD=tm-db-password:latest \
  --set-env-vars TM_BUCKET=your-bucket,GOOGLE_CLIENT_ID=your-client-id
```

Then set `API`, `MAPS_KEY` and `GOOGLE_CLIENT_ID` at the top of the script in `web/index.html`, and deploy `web/` anywhere static.

Tree health notes are observations made from video by an AI model, not an arborist's diagnosis.

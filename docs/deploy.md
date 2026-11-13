# Deploying TutorOS

Target: existing Supabase cloud project + existing Vercel project, running on the
`*.vercel.app` URL, with Resend for transactional email.

Work top to bottom. Steps 4 and 5 are the ones that silently half-work if skipped
— the app will look fine and invitations will quietly break. Step 9 (turning on
AI extraction) is additive: steps 1–8 give you a fully working app without it.

Throughout, `PROJECT_REF` is your Supabase project ref (the subdomain in
`https://<ref>.supabase.co`) and `APP_URL` is your production URL —
`https://getdolphn.com`, **no trailing slash**. The `*.vercel.app` names still
resolve and still serve the app, so every origin users can actually reach has to
be allowlisted in step 4, not just the canonical one.

---

## 1. Link the CLI to the cloud project

```bash
npx supabase login
npx supabase link --project-ref PROJECT_REF
```

## 2. Run the migrations

Migrations are Drizzle's (`lib/db/migrations/`), not `supabase db push`. Use the
**direct** connection (port 5432), *not* the pooler — pooled connections can't
run DDL reliably.

Supabase dashboard → Project Settings → Database → Connection string → URI.

```bash
DATABASE_URL="postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres" \
  pnpm db:migrate
```

`drizzle.config.ts` loads `.env.local`, but dotenv does not override a variable
already set in the shell — so the inline `DATABASE_URL` above wins. Verify:

```bash
psql "postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres" -c "\dt"
```

You should see **18** tables, matching `lib/db/schema.ts`.

If you see 15, the database is at `0001` and is missing `0002` — the syllabus
migration, which creates `syllabuses`, `concepts` and `topic_concepts` and adds
`syllabus_id` to `topics`. Re-run `pnpm db:migrate`; the app works fine without
it right up until the first syllabus upload.

Note that `0002` adds `topics.syllabus_id` as `NOT NULL` with no default, which
fails if `topics` has rows. It has been an unused forward-compat hook since
`0000`, so it is empty in practice — but a project that started tagging topics
by hand would need a backfill first.

## 3. Create the storage buckets

There are **three**, all private, all declared in `supabase/config.toml` — so
none needs to be hand-built:

| Bucket | Holds | Declared at | MIME list |
|---|---|---|---|
| `materials` | session materials and submissions | `config.toml:125` | `lib/storage/config.ts:26` |
| `syllabus-documents` | uploaded syllabus source documents | `config.toml:147` | `lib/storage/config.ts:59` |
| `question-documents` | question-import PDFs and (slice 3) figure-crop PNGs | `config.toml:159` | `lib/storage/config.ts:86` (imports; crops add PNG in slice 3) |

```bash
npx supabase seed buckets --linked
```

That creates every bucket in `config.toml`, and is safe to re-run. Confirm in
the dashboard → Storage that **all three** exist, **none** is public, and each
shows a 25 MiB limit. If any reports public, stop and fix it — every download
in the app assumes the bucket is private and that signed URLs are the only way
in.

`syllabus-documents` and `question-documents` are newer than `materials` and
easy to miss if you ran this step before they existed: nothing warns you, and
the symptom is `Bucket not found` on the first upload into the missing one
(`question-documents` allows only `application/pdf` and `image/png`). Re-run the command rather than assuming a
project set up earlier has it.

Fallback, if the CLI misbehaves — dashboard → Storage → New bucket, once per
bucket:
- Name as above, **Public: off**
- File size limit `25 MiB`
- Allowed MIME types: copy the matching list from `lib/storage/config.ts`

## 4. Auth settings (dashboard)

> **Do not run `supabase config push`.** It pushes the whole `[auth]` block,
> including `site_url = "http://127.0.0.1:3000"` and the localhost redirect list,
> straight into production. These settings are environment-specific and belong in
> the dashboard.

Dashboard → Authentication → URL Configuration:

- **Site URL**: `APP_URL`
- **Redirect URLs**, one per line — **all four**:
  ```
  https://getdolphn.com/**
  https://www.getdolphn.com/**
  https://dolphin-ruddy-ten.vercel.app/**
  https://*-anand2273s-projects.vercel.app/**
  ```

Every emailed link — invite, magic link and password reset — is built from the
**request's own host**, and GoTrue refuses any `redirectTo` not on this list. So
this is not "the production URL"; it is *every origin a user might be browsing
when they trigger an email*:

- the custom domain, which is the one real users are on;
- `www.`, if the domain serves it — a different host is a different entry;
- the `*.vercel.app` production alias, which keeps resolving after you add a
  custom domain and is easy to forget;
- the last line, preview deployments (`<project>-git-<branch>-<scope>.vercel.app`).

Adding a custom domain **does not** update this list, and nothing warns you. The
symptom is that email links point at whatever the Site URL is rather than the
domain the user was actually on.

**The refusal is silent.** GoTrue does not error; it substitutes the Site URL and
sends the mail anyway. The symptom is a link pointing at the *wrong host* with
the path stripped — our templates append `&token_hash=…` to `{{ .RedirectTo }}`,
so a bare Site URL with no `?` produces a mangled URL the browser rejects
outright:

```
https://dolphin-ruddy-ten.vercel.app&token_hash=…&type=recovery
```

If you see that, it is this allowlist, not the template. Without the wildcard,
auth email works in production and fails on every preview with no obvious cause.

## 5. Email templates (dashboard) — **the one that silently breaks invites**

Dashboard → Authentication → Emails → Templates.

Supabase's stock templates build their link from `{{ .ConfirmationURL }}`, which
routes through Supabase's own verify endpoint and returns tokens in a URL
**fragment**. Server Components cannot read a fragment, so the invitee arrives at
the accept page with no session and gets bounced to `/login` — where, having never
set a password, they are stuck. That is exactly the bug fixed in `075786c`, and
the stock cloud templates reintroduce it.

Replace three templates with the contents of this repo:

| Template | Paste from | Subject |
|---|---|---|
| **Invite user** | `supabase/templates/invite.html` | You've been invited to Dolphn |
| **Magic Link** | `supabase/templates/magic_link.html` | Join your class on Dolphn |
| **Reset Password** | `supabase/templates/recovery.html` | Reset your Dolphn password |

All three build their href from `{{ .RedirectTo }}`, which our actions set to
`/auth/confirm?next=…` on the origin the user is actually on. The whole chain
then stays on one host and the session cookie survives.

The reset template fails the same way and just as quietly: a stock **Reset
Password** template lands the user on `/reset-password` with no session, where
they get the "open this from your reset email" card and no way forward. There is
no error anywhere — it looks like the link is broken.

## 6. Custom SMTP with Resend

Supabase's built-in email is rate-limited to a handful per hour and is explicitly
not for production. Invitations are the app's only transactional email, and they
are load-bearing — a student who never gets the email cannot join.

1. Resend → add and verify a sending domain (SPF + DKIM DNS records). On a
   `vercel.app` URL you have no domain of your own, so either verify a domain you
   own for the *sender address only*, or accept `onboarding@resend.dev` for
   testing and expect spam-foldering.
2. Resend → API Keys → create one.
3. Dashboard → Authentication → Emails → SMTP Settings → Enable custom SMTP:

   | Field | Value |
   |---|---|
   | Host | `smtp.resend.com` |
   | Port | `587` |
   | Username | `resend` |
   | Password | your Resend API key |
   | Sender email | an address on your verified domain |
   | Sender name | TutorOS |

4. **Raise the email rate limit.** Dashboard → Authentication → Rate Limits →
   "Emails sent per hour". `supabase/config.toml` carries `email_sent = 2`, which
   is a local-dev default that only takes effect *once custom SMTP is enabled* —
   the trap being that turning on SMTP is what activates it. Two per hour will
   cripple a tutor onboarding a class. Set it to something real (100+).

For SendGrid or Postmark instead: same fields, `smtp.sendgrid.net` / port 587 /
username `apikey`, or `smtp.postmarkapp.com` / port 587 with your server token as
both username and password.

## 7. Vercel environment variables

Project → Settings → Environment Variables. Set for Production **and** Preview:

| Name | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://PROJECT_REF.supabase.co` | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key | public |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key | **secret — never `NEXT_PUBLIC_`** |
| `DATABASE_URL` | pooled URI, see below | secret |
| `GEMINI_API_KEY` | paid-tier Gemini key | **secret**; only needed for step 9 |

`GEMINI_API_KEY` lives here because extraction runs inside the Next app (see
step 9). Without it, an upload is saved and its extraction fails with
"GEMINI_API_KEY is not set" on the syllabus page — nothing is lost; set the
key, redeploy, and hit Retry.

`DATABASE_URL` must be the **transaction pooler** (port 6543), not the direct
connection — serverless functions open far too many connections otherwise:

```
postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
```

`lib/db/client.ts` already sets `prepare: false`, which is required for the
transaction pooler. Don't remove it.

The service-role key is read by `lib/auth/supabase-admin.ts` and `lib/storage/`.
It is server-only by construction: it isn't a `NEXT_PUBLIC_` var, so it cannot
initialize in the browser. Keep it that way.

## 8. Deploy and verify

```bash
git push origin main     # or: npx vercel --prod
```

Then walk the flows that the checkpoints actually cover. Each line here has
failed at least once during development:

- [ ] Tutor signs up at `/signup`, lands on `/dashboard`
- [ ] Tutor creates a class, then a lesson; the lesson opens
- [ ] Times render in **your** timezone, not the server's
- [ ] Tutor uploads a PDF material; it appears with the right size
- [ ] Download works, and the URL you land on is a **signed** storage URL
- [ ] Tutor invites a brand-new email → email arrives (check Resend's log)
- [ ] The link goes to `APP_URL/auth/confirm?...` — **not** to `supabase.co`.
      If it points at supabase.co, step 5 didn't take
- [ ] Clicking it shows **"Create account & join"**, not a login form.
      A login form means the session was lost — check step 4's Site URL
- [ ] After joining, the student sees the class, the lesson, and can download
- [ ] Signed out, `APP_URL/api/materials/<id>/download` returns 401
- [ ] Signed in as a *different* tutor, the same URL returns 404

## 9. AI extraction (syllabus topics and question import)

Additive: steps 1–8 give you a fully working app. This step turns on reading
uploaded syllabus and question PDFs with Gemini.

**There is no separate worker or Redis any more** (*changed 2026-11-13*).
Extraction runs inside the same Vercel function that handled the upload, via
`after()` (`lib/extraction/start.ts`), after the response has gone back. The
old Railway worker and Upstash Redis can be deleted outright.

### 9a. Turn on Fluid Compute

Vercel → Project → Settings → Functions → **Fluid Compute: on**. New projects
have it on by default since April 2025; older ones may not. Without it, Hobby
functions are cut off at **60 seconds**, which is shorter than many
extractions, and they will show as failed after 10 minutes. With it, the
syllabus pages' `maxDuration = 300` applies (5 minutes).

### 9b. Environment

Add `GEMINI_API_KEY` to Vercel (step 7), then redeploy. Remove `REDIS_URL` if
it is still there — nothing reads it.

### 9c. Verify

Upload a small syllabus PDF on `/syllabi`.

- [ ] The pill shows **Extracting…** and, within a minute or two, topics appear
- [ ] Vercel → Logs shows `[syllabus-extraction] done — syllabus <id>`

### 9d. When it goes wrong

Every outcome lands on the row, and the syllabus page shows the reason with a
Retry button. Vercel → Logs → filter on `extraction` for the full error.

- **"GEMINI_API_KEY is not set"** — step 9b. Not retried automatically.
- **"Gemini did not finish cleanly (MAX_TOKENS …)"** — read the token split in
  the message before raising any limit (CLAUDE.md, Question extraction).
- **"Extraction stopped before finishing (it may have timed out)"** — the row
  sat in flight for 10+ minutes, which means the function was killed: a timeout
  (check 9a), or a redeploy mid-run. Retry. If a particular document always
  does this, it is too large for 300s; Vercel Pro allows `maxDuration` up to 800.
- **429 / "Too Many Requests"** — each Gemini call is retried 3 times with
  backoff (`lib/extraction/retry.ts`). Seeing it as a final error means many
  large uploads at once; add a concurrency cap on chunks.

### 9e. Know before you ship

- **A redeploy kills extractions in flight.** They surface as failed after 10
  minutes and need a Retry. Avoid deploying while a tutor is mid-upload.
- **One chunk that fails all 3 tries fails the whole document**, and Retry
  re-pays for every chunk. Watch cost if you see repeated failures on large PDFs.

---

## Known gaps to close before real users

1. **`enable_confirmations` is off.** Anyone can self-signup as an address they
   don't control, then wait to be invited to a class — which defeats the
   email-binding the whole invite model rests on. `findAccountByEmail` closes the
   invite-shell case only. Turning confirmations on needs a "check your email"
   state in both signup flows, which isn't built. Locally this is theoretical; on
   a public URL it is not. See the open decision in CLAUDE.md.
2. **No backups configured.** Student work is not recoverable.
3. **Storage objects are never reclaimed.** Deleting a material soft-deletes the
   row and deliberately leaves the object. There is no cleanup job yet.
4. **AI extraction depends on step 9** (Fluid Compute + `GEMINI_API_KEY`).
   Until then, uploads are saved but read as failed, and presets and manual
   topic entry still work.

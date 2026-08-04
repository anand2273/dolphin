# Deploying TutorOS

Target: existing Supabase cloud project + existing Vercel project, running on the
`*.vercel.app` URL, with Resend for transactional email.

Work top to bottom. Steps 4 and 5 are the ones that silently half-work if skipped
— the app will look fine and invitations will quietly break. Step 9 (Redis and
the extraction worker) is additive and optional: steps 1–8 give you a fully
working app without it.

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

You should see 15 tables.

## 3. Create the storage bucket

The bucket is declared in `supabase/config.toml` under `[storage.buckets.materials]`,
so it doesn't need to be hand-built:

```bash
npx supabase seed buckets --linked
```

Confirm in the dashboard → Storage that `materials` exists, is **not** public, and
shows a 25 MiB limit. If it reports public, stop and fix it — every download in
the app assumes the bucket is private and that signed URLs are the only way in.

Fallback, if the CLI misbehaves — dashboard → Storage → New bucket:
- Name `materials`, **Public: off**
- File size limit `25 MiB`
- Allowed MIME types: copy the list from `lib/storage/config.ts`

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
| `REDIS_URL` | Railway's **public** `redis://…proxy.rlwy.net:PORT` | secret; only needed once step 9 is done |

`REDIS_URL` is required here because the Next app is the **producer** side of the
extraction queue (`lib/queue/syllabus-extraction.ts`). Without it, uploading a
syllabus document throws "REDIS_URL is not set" at enqueue time even if the
worker itself is running perfectly.

It points at the **same database** the worker uses but not via the same
address: Vercel is outside Railway's private network, so it takes the public
TCP proxy URL while the worker takes the private one. See step 9a — this
asymmetry is the easiest thing in step 9 to get wrong.

`GEMINI_API_KEY` deliberately does **not** belong here. Only the worker calls
Gemini; putting the key in Vercel's env widens its blast radius for nothing.

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

## 9. Redis and the syllabus-extraction worker

Additive: steps 1–8 give you a fully working app. This stage only turns on
syllabus extraction. Everything else keeps working if you skip it — but a
tutor who uploads a syllabus document will see it sit at `pending` forever,
so don't ship the Syllabi UI without it.

One new host, because Vercel cannot run a persistent queue consumer:
a **single Railway project** holding two services — a Redis database and the
`worker/` process. Keeping both in one project is the point: they talk over
Railway's private network, so every BullMQ round trip stays inside the
datacentre and Redis is billed as compute rather than per command.

> Render, Fly and Upstash all host the same shape and the app does not care.
> The end of this section notes what changes if you split Redis onto Upstash.

Rough cost: Railway's Hobby plan is $5/month including $5 of usage credit;
one idle worker plus a small Redis lands around there.

### 9a. The Redis service

Railway dashboard → **New Project** → **Deploy Redis**. Nothing to configure;
the defaults are what BullMQ needs. What matters is which of the two URLs
Railway hands you goes where:

| Variable | Host | Who uses it |
|---|---|---|
| `REDIS_URL` | `redis://default:PASS@<region>.proxy.rlwy.net:PORT` | **Vercel** (step 7) — public TCP proxy |
| `REDIS_PRIVATE_URL` | `redis://default:PASS@redis.railway.internal:6379` | **the worker** (9c) — private network |

Both address the same database. This asymmetry is deliberate and is the one
part of this step people get wrong: Vercel is not on Railway's private
network, so it *must* use the public proxy; the worker *is*, so routing it
through the public proxy would add latency and billable egress for nothing.

Three things worth knowing:

- **Railway's private network is IPv6-only**, and Node's default DNS lookup
  will not resolve `redis.railway.internal` without help. Both connections
  therefore pass `family: 0` to ioredis (`worker/index.ts`,
  `lib/queue/syllabus-extraction.ts`), which allows an A *or* AAAA answer.
  Without it the worker dies at boot with `ENOTFOUND redis.railway.internal`.
  The option is harmless on every other URL form, which is why it is set
  unconditionally rather than behind a host check.
- **Neither URL is TLS** — Railway terminates nothing in front of Redis, and
  the private network is already isolated. `redis://` is correct here; do not
  "fix" it to `rediss://`, which will fail the handshake. (Upstash is the
  opposite — see the note at the end of this section.)
- **Confirm the eviction policy is `noeviction`.** BullMQ requires it, and
  Railway's Redis image ships with no `maxmemory` set, which means
  `noeviction` in practice. Verify rather than assume: if keys can be evicted
  under memory pressure, queued jobs vanish with no error anywhere and the
  syllabus stays `pending` forever. This is the nastiest failure in the whole
  step precisely because it looks like nothing happened.

`maxRetriesPerRequest: null` is BullMQ's other hard requirement and is already
set on both sides. It looks like a redundant option. It is not — do not "tidy"
it away, and the same goes for `family: 0`.

### 9b. The worker service

In the same project → **New** → **GitHub Repo** → this repo.

| Setting | Value |
|---|---|
| Build command | `pnpm install` |
| Start command | `pnpm worker:start` |
| Watch paths | `worker/**`, `lib/**`, `package.json` |

Railway has no separate "background worker" service type — it just runs the
start command and never health-checks for an open port, which is exactly what
`worker/index.ts` needs. (On Render this is the difference between a
**Background Worker** and a **Web Service**: pick a Web Service there and the
port health check restart-loops it forever.)

Set the **watch paths**. Without them every push to the repo — including a
pure Next.js/UI change — redeploys the worker and interrupts any extraction
in flight. The worker has no graceful shutdown handler yet (see `status.md`),
so an interrupted job relies on BullMQ's stalled-job recovery.

**`tsx` now lives in `dependencies`, not `devDependencies`** — deliberately.
`worker:start` *is* `tsx worker/index.ts`, so on a host that sets
`NODE_ENV=production` (Railway and Render both do) pnpm skips devDependencies
and the service dies with `tsx: not found`. It genuinely is a runtime
dependency for this process. If you ever move it back, the workaround is
`NPM_CONFIG_PRODUCTION=false` in the env or a build command of
`pnpm install --prod=false`.

### 9c. Worker environment variables

On the worker service → **Variables**:

| Name | Value | Notes |
|---|---|---|
| `REDIS_URL` | `${{Redis.REDIS_PRIVATE_URL}}` | **private** URL — not Vercel's value; see below |
| `DATABASE_URL` | **session pooler (5432)** | see below — also not Vercel's value |
| `GEMINI_API_KEY` | paid-tier Gemini key | worker only; never on Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key | mints the signed download URL |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://PROJECT_REF.supabase.co` | yes, really — see below |

Use Railway's **reference syntax** (`${{Redis.REDIS_PRIVATE_URL}}`) rather than
pasting the literal string, so a Redis credential rotation propagates on its
own. Note the variable is named `REDIS_URL` *on the worker* even though it
points at Railway's `REDIS_PRIVATE_URL` — both `worker/index.ts` and
`lib/queue/syllabus-extraction.ts` read `REDIS_URL` and neither knows or cares
which address it holds.

Three of those are counter-intuitive:

- `REDIS_URL` is the *private* URL here and the *public proxy* URL on Vercel
  (9a). They are different strings pointing at one database. "Both hosts must
  agree on `REDIS_URL`" means the same database, not the same literal value.
- `NEXT_PUBLIC_SUPABASE_URL` looks Next-only, but `lib/auth/supabase-admin.ts`
  reads it and the worker reaches that code through `createSignedDownloadUrl`
  when it fetches the uploaded document. It has to be set on a host that has
  nothing to do with Next.
- `DATABASE_URL` must **not** be the transaction pooler (6543) that step 7
  specifies for Vercel. That advice exists because serverless functions open
  many short-lived connections. The worker is the opposite: one long-lived
  process at `concurrency: 2` running multi-statement transactions. Use the
  session pooler or the direct connection on **5432**.

### 9d. Verify

Deploy the worker first and watch its log for:

```
[syllabus-extraction] worker started, waiting for jobs
```

That line alone proves the private DNS name resolved, `family: 0` did its job
and Redis auth is good. Then put the **public proxy** `REDIS_URL` into Vercel
(step 7), redeploy, and upload a syllabus document through the UI.

- [ ] The status pill moves `pending` → `processing` → `done`
- [ ] Topics and concepts appear on the syllabus page
- [ ] The worker log shows `done — syllabus <id>`

Reading a failure:

- **`ENOTFOUND redis.railway.internal` at worker boot** — the connection lost
  its `family: 0`, or the worker is not in the same Railway project as the
  Redis service. Private DNS does not cross projects.
- **Stuck on `pending`** — the job never reached the worker. Either the two
  hosts are pointed at *different databases* (check that Vercel has the public
  proxy URL for this project's Redis, not a stale one), or eviction is on and
  dropped it (9a).
- **`processing` → `failed`** — the worker got it and something inside blew
  up. The UI deliberately shows only a friendly message now, so read the real
  error from `syllabuses.extraction_error` in the database.

### If you split Redis onto Upstash instead

Everything above holds except 9a. Take Upstash's **TCP/Redis-protocol** URI —
the `rediss://default:PASSWORD@HOST:6379` one — and use that single value on
both hosts. **Not** the REST URL (`UPSTASH_REDIS_REST_URL`): BullMQ speaks the
real Redis protocol through ioredis and cannot use the REST endpoint at all.
The double-s in `rediss://` is TLS, which Upstash requires and ioredis infers
from the scheme.

- **Disable eviction explicitly** — Upstash does not default to `noeviction`
  the way Railway's image does.
- **Put it in the same region** as the worker host and the Supabase project.
  Every BullMQ operation is a round trip.
- Upstash **bills per command**, and an idle BullMQ worker issues blocking
  poll commands continuously — roughly 3k/day per worker against the free
  tier's 10k/day. Fine at one worker; check the usage graph after a few days
  rather than assuming idle means free. This is the main reason the primary
  path above keeps Redis on Railway.

### 9e. Know before you ship

The two findings that previously blocked this — a retry that failed once a
syllabus already had topics, and the ambiguous model pin — were fixed on
2026-08-04. Re-extraction is now idempotent, and the model choice is settled
and guarded. Neither should hold up a deploy.

What remains open (full list in [`status.md`](status.md)) and is worth knowing
when reading production incidents:

- **Concurrent jobs for the same tutor can still collide on concept
  creation**, failing one of the two jobs with a 23505. The worker runs
  `concurrency: 2`, so this needs two extractions running at once for the
  same tutor. BullMQ retries it, and the retry usually succeeds because the
  concept now exists.
- **One failed chunk discards the whole document's results**, so a single
  transient Gemini error re-pays for every chunk on retry. Watch cost if you
  see repeated failures on large PDFs.

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
4. **The extraction worker isn't deployed yet.** Step 9 is written but has not
   been carried out — there is no Railway project, no production Redis and no
   `REDIS_URL` in Vercel today. Verified working locally only. The worker also
   carries known open bugs; see the review findings in [`status.md`](status.md)
   before putting it in front of real users.

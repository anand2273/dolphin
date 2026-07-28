# Deploying TutorOS

Target: existing Supabase cloud project + existing Vercel project, running on the
`*.vercel.app` URL, with Resend for transactional email.

Work top to bottom. Steps 4 and 5 are the ones that silently half-work if skipped
— the app will look fine and invitations will quietly break.

Throughout, `PROJECT_REF` is your Supabase project ref (the subdomain in
`https://<ref>.supabase.co`) and `APP_URL` is your production URL, e.g.
`https://tutoros.vercel.app` — **no trailing slash**.

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
- **Redirect URLs**, one per line:
  ```
  https://tutoros.vercel.app/**
  https://*-YOUR-VERCEL-SCOPE.vercel.app/**
  ```

The second line covers preview deployments. It matters because `inviteStudent`
builds the confirmation link from the **request's own host** — so an invite sent
from a preview deploy mints a preview-host URL, and GoTrue refuses any
`redirectTo` that isn't on this allowlist. Without the wildcard, invites work in
production and fail on previews with no obvious cause.

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

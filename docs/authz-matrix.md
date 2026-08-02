# Dolphn — Authorization Matrix (v1)

This is the contract the single server-side authz helper (`lib/auth`) must enforce.
Every mutation follows **parse → authorize → mutate → revalidate**; the rows below
are the "authorize" step. Nothing here is enforced by the client, and no role,
class id, session id or student id from the client is trusted.

## Columns (relationship to the *specific resource* in question)

| Column | Who |
|---|---|
| **Tutor** | The tutor who **owns the class** the resource belongs to. |
| **Enrolled student** | A student with a live enrollment in that class. |
| **Other student** | An authenticated student **not** enrolled in that class. |
| **Stranger** | Unauthenticated **or** any authenticated user unrelated to the resource — **this includes a *different tutor***. |

Cells: **✔** allow · **✘** deny.
"own" = the row's `student_id` / uploader is the acting user.

**Roles are global.** Every account is either a **tutor** (paying, self-signup)
or a **student** (invited, low-privilege), fixed at creation via `profiles.role`.
This is the coarse gate (which half of the app you can reach + the billing
boundary). On top of it, each row is still evaluated against the *specific
resource* via the relationship check (owner / enrolled / none).

## Matrix

| # | Action | Tutor | Enrolled student | Other student | Stranger |
|---|---|:--:|:--:|:--:|:--:|
| **Account / auth** |
| 1 | Sign up as tutor | ✔ | ✔ | ✔ | ✔ (public) |
| 2 | Log in | ✔ | ✔ | ✔ | ✔ (public) |
| 3 | View / edit **own** profile | ✔ | ✔ | ✔ | ✘ |
| 4 | Self-register a student account (no invite) | ✔ | ✔ | ✔ | ✔ (public) |
| 4a | Request a password reset email | ✔ | ✔ | ✔ | ✔ (public) ⁶ |
| 4b | Set a new password | ✔ ⁷ | ✔ ⁷ | ✔ ⁷ | ✘ |
| **Class** |
| 5 | Create class | ✔ | ✘ | ✘ | ✘ |
| 6 | View class (list / detail) | ✔ | ✔ | ✘ | ✘ |
| 7 | Edit class (name, subject) | ✔ | ✘ | ✘ | ✘ |
| 8 | Soft-delete class | ✔ | ✘ | ✘ | ✘ |
| 9 | View class roster (other students) | ✔ | ✘ ¹ | ✘ | ✘ |
| **Invitation / enrollment** |
| 10 | Invite a student (by email) to class | ✔ | ✘ | ✘ | ✘ |
| 11 | Revoke a pending invitation | ✔ | ✘ | ✘ | ✘ |
| 12 | Accept an invitation | ✔ ² | ✔ ² | ✔ ² | ✔ ² |
| 13 | Remove / unenroll a student | ✔ | ✘ | ✘ | ✘ |
| **Session** |
| 14 | Create session in class | ✔ | ✘ | ✘ | ✘ |
| 15 | View session (list / detail) | ✔ | ✔ | ✘ | ✘ |
| 16 | Edit session | ✔ | ✘ | ✘ | ✘ |
| 17 | Soft-delete session | ✔ | ✘ | ✘ | ✘ |
| **Material** |
| 18 | Upload material to session | ✔ | ✘ | ✘ | ✘ |
| 19 | List materials in session | ✔ | ✔ | ✘ | ✘ |
| 20 | Download material (signed URL) | ✔ | ✔ | ✘ | ✘ |
| 21 | Soft-delete material | ✔ | ✘ | ✘ | ✘ |
| **Assignment** |
| 22 | Issue assignment in session | ✔ | ✘ | ✘ | ✘ |
| 23 | Attach worksheet PDF to assignment | ✔ | ✘ | ✘ | ✘ |
| 24 | View / list assignments | ✔ | ✔ | ✘ | ✘ |
| 25 | Download assignment worksheet (signed URL) | ✔ | ✔ | ✘ | ✘ |
| 26 | Edit assignment (title, due, review session) | ✔ | ✘ | ✘ | ✘ |
| 27 | Soft-delete assignment | ✔ | ✘ | ✘ | ✘ |
| **Submission** |
| 28 | Create **own** submission | ✔ ³ | ✔ | ✘ | ✘ |
| 29 | Upload submission **on behalf of** a student | ✔ | ✘ | ✘ | ✘ |
| 30 | Resubmit (new version) of **own** work | ✔ ³ | ✔ | ✘ | ✘ |
| 31 | View **own** submission | ✔ | ✔ | ✘ | ✘ |
| 32 | View **another student's** submission | ✔ ⁴ | ✘ | ✘ | ✘ |
| 33 | Download submission file (signed URL) | ✔ ⁴ | ✔ (own only) | ✘ | ✘ |
| 34 | See submission status across the whole class | ✔ | ✘ | ✘ | ✘ |
| 35 | Soft-delete a submission | ✔ | ✘ ⁵ | ✘ | ✘ |
| **Feedback** |
| 36 | Add feedback to a submission | ✔ | ✘ | ✘ | ✘ |
| 37 | View feedback on **own** submission | ✔ | ✔ | ✘ | ✘ |
| **Syllabus** ⁸ |
| 38 | Create syllabus (manual, upload, or from preset) | ✔ | ✘ | ✘ | ✘ |
| 39 | View / list **own** syllabuses, topics, concepts | ✔ | ✘ | ✘ | ✘ |
| 40 | Edit syllabus, its topics, or its concepts | ✔ | ✘ | ✘ | ✘ |
| 41 | Soft-delete syllabus | ✔ | ✘ | ✘ | ✘ |
| **Assignment topics (still CP6-unbuilt)** |
| 42 | Create / tag topics on an assignment | ✔ | ✘ | ✘ | ✘ |

### Footnotes
1. **A student never sees another student's identity list.** Even inside a
   (future) group class, the roster is tutor-only. Students see materials and
   assignments, never the member list or anyone else's submissions.
2. **Acceptance is gated by email control, not by the click.** Anyone can *open*
   an invite link, but the enrollment is bound to the invited email address —
   the actor must prove control of that email (Supabase auth). Forwarding the
   link enrolls nobody new. A pending, unexpired, unrevoked invite is required.
3. Rows 28/30/31 ("own" submission) apply to whoever the submission's
   `student_id` is. Roles are global and strictly separated: a tutor account is
   never also an enrolled student (inviting a tutor's email as a student is
   blocked), so "own submission" always belongs to a student account.
4. The tutor can read **all** submissions **in their own class** (rows 32/33).
   A tutor of a *different* class is a **Stranger** here → ✘.
5. Submissions are **append-only**; "delete" is a tutor-only soft-delete for
   accidental-upload cleanup. Students cannot delete or overwrite submitted work.
6. **The response is identical for a registered and an unregistered address.**
   Requesting a reset is public by necessity — the whole point is that the
   requester cannot sign in — so the only thing to protect is whether an address
   has an account. Row 4 discloses that on purpose (it buys the invite-shell
   gate); this row must not.
7. **A session is not sufficient authority.** A recovery link *is* a sign-in, so
   setting a password requires the session **plus** the single-use recovery
   marker `/auth/confirm` mints for that same user id. Without the second
   condition, "set a new password" collapses into row 3 and anyone at an
   unattended signed-in browser can take the account over. Completing a reset
   revokes every other session for that account.
8. **A syllabus has no class and no "enrolled" relationship at all.** The
   "Tutor" column here means *the syllabus's own owning tutor* specifically —
   there is no "Enrolled student" or "Other student" case to distinguish,
   because a syllabus is a standalone resource (`classes.syllabus_id` isn't
   built yet). Every non-owner — a different tutor or any student — is a
   **Stranger** by the column definition above. `assertSyllabusOwner` is a
   single ownership check (`syllabus.tutorId === userId`), not the two-question
   class-relationship pattern the rest of this matrix uses.

## The two questions the helper asks on every request

Per CLAUDE.md, `lib/auth` resolves, for the current user + target resource:

1. **Membership** — *Is this user related to this class?*
   (owning tutor? enrolled student? neither?)
2. **Capability** — *Does their role + relationship permit this action on this
   resource?* (e.g. "read submission" requires `tutor-of-class` **or**
   `student == submission.student_id`.)

Both must pass. The resource's class is always re-derived on the server from the
resource id — never taken from the client.

**Syllabus is the one exception** (footnote 8): there's no class to re-derive,
so `assertSyllabusOwner` collapses both questions into one ownership check —
membership *is* the capability, since only the owning tutor has a relationship
to a syllabus at all.

## Highest-value negative tests (write these as we build each slice)

- Tutor **B** cannot read Tutor **A**'s class / session / material / submission. (rows 6,15,20,32)
- Enrolled student **cannot** read another enrolled student's submission or files. (rows 32,33)
- Enrolled student **cannot** issue an assignment, upload a material, or create a session. (rows 18,22,14)
- Other student (not enrolled) **cannot** list a class's sessions/materials/assignments. (rows 15,19,24)
- A forwarded invite link does **not** enroll a different email. (row 12 / footnote 2)
- Expired / revoked / already-accepted invite **cannot** be accepted. (row 12)
- Student **cannot** delete or overwrite a submission; resubmit only appends. (rows 30,35)
- Signed URL minted for user X's submission is **not** issued to user Y. (row 33)
- A signed-in session with **no** recovery marker cannot set a new password, and
  a marker minted for user X cannot be spent by user Y. (row 4b / footnote 7)
- Tutor **B** cannot read, edit, or list Tutor **A**'s syllabus, topics, or
  concepts, and a student has no path to any of them at all. (rows 38–41)
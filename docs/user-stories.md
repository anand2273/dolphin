# Dolphn — User Stories (v1)

Grouped by actor. Each story carries an ID, the requirement it derives from, and
acceptance criteria written so they can be checked rather than argued about.

Status: **Built** · **Partial** · **Planned**

Only two actors exist in v1. There is no admin, no agency owner, and no
second tutor on a class — see [`requirements.md`](requirements.md) for the full
exclusion list.

---

## Tutor — the paying user

### US-T1 · Create my account · Built · FR-1
*As a tutor, I want to sign up on my own, so I can start using the app without
waiting for anyone.*

- Signing up at `/signup` creates a `tutor` account and lands on `/dashboard`
- The role comes from the entry point used, never from anything I submit
- An email that already has an account is refused with a message telling me to
  sign in instead

### US-T2 · Organise work into classes · Built · FR-2
*As a tutor, I want a class per engagement, so a student's materials and lessons
stay together.*

- I can create a class with a name and optional subject
- My dashboard lists only my classes
- Another tutor's class URL is indistinguishable from one that doesn't exist

### US-T3 · Invite a student by email · Built · FR-3
*As a tutor, I want to invite a specific person, so only they can join my class.*

- I enter an email; they receive a link
- The invitation expires in 7 days and works once
- Someone who forwards the link cannot use it — acceptance requires control of
  the invited address
- A brand-new invitee is offered "create account & join"; an existing student
  gets one-click "join"

### US-T4 · Manage pending invitations · Built · FR-3
*As a tutor, I want to withdraw or re-send an invitation, so a mistake or a lost
email isn't permanent.*

- Pending invitations are listed on the class page with their sent date
- Revoking makes the link stop working immediately
- Re-inviting the same address re-sends rather than silently doing nothing

### US-T5 · See my roster · Built · FR-2
*As a tutor, I want to see who has joined and who hasn't, so I know where a
student is stuck.*

- Enrolled students and pending invitations are shown separately, each with a count

### US-T6 · Plan and log lessons · Built · FR-4
*As a tutor, I want lessons both ahead of time and after the fact, because I
schedule some and record others.*

- I can create a lesson with an optional title and a date/time, past or future
- Lessons show as **Planned** or **Delivered**, derived from the time — I never
  set a status
- Times display in my own timezone

### US-T7 · Correct a lesson · Built · FR-4
*As a tutor, I want to fix a wrong time or title, and remove a lesson I created
by mistake, without destroying anything attached to it.*

- Editing a lesson does not move any homework due dates
- Removing a lesson hides it from both roles but does not destroy its files

### US-T8 · Attach materials to a lesson · Built · FR-5
*As a tutor, I want worksheets and notes attached to the lesson they belong to,
so nothing floats free.*

- I upload a file to a specific lesson; it appears with its real size
- Files over the cap, or of a disallowed type, are refused with a clear reason
- I can remove a material from the lesson

### US-T9 · Trust the boundaries · Built · NFR-1, NFR-2
*As a tutor, I want to be certain a student sees only their own class, because I
teach competitors and my materials are my product.*

- A student of another class receives a 404, not an error hinting the file exists
- No file is reachable without an authorization check first
- Every rule here has a negative test

### US-T10 · Issue homework · Planned · FR-6
*As a tutor, I want to set homework during a lesson with its own deadline,
because the deadline rarely matches the next lesson.*

- The assignment belongs to the lesson it was issued in
- Its due date is set independently of any lesson date
- I may attach a worksheet
- I may nominate a later lesson to review it in

### US-T11 · Collect paper submissions · Planned · FR-7
*As a tutor, I want to upload work a student handed me on paper, because most of
my students do exactly that.*

- I upload on the student's behalf; the work is recorded as theirs
- The record still shows that I was the uploader

### US-T12 · Give feedback · Planned · FR-7
*As a tutor, I want to record feedback against a submission, so the student can
see what to fix.*

- Feedback attaches to a specific submission version
- The record distinguishes tutor-authored feedback from any future automated source

### US-T13 · Maintain my profile · Partial · FR-8
*As a tutor, I want my name shown to students, so invitations look like they came
from a person.*

- My name appears on invitations and class pages
- **Gap:** there is no UI to edit it after signup

---

## Student — invited, low-privilege

### US-S1 · Join when invited · Built · FR-1, FR-3
*As an invited student, I want to go from email to inside the class in one step,
because I don't want to manage another account.*

- The emailed link signs me in and takes me straight to a create-account-and-join form
- I set a password once and I'm enrolled
- If I already have an account, it's a single "join" click instead

### US-S2 · Recover from a dead link · Built · FR-3
*As an invited student, I want to understand what went wrong if the link fails,
rather than staring at a login form I can't use.*

- An already-used or expired link explains itself and tells me to ask for another
- I am never dropped onto a login form before I have a password

### US-S3 · See my classes and lessons · Built · FR-4
*As a student, I want to see what lessons I've had and what's coming.*

- My dashboard lists my classes, each with its lessons
- I can open a lesson and see its details, read-only
- Times display in my timezone, not my tutor's

### US-S4 · Get my materials · Built · FR-5
*As a student, I want to download the worksheets for my lesson.*

- Every material for the lesson is listed with its filename and size
- Download works, and the link I receive is short-lived
- I see no controls to upload, edit or remove anything

### US-S5 · Submit homework · Planned · FR-7
*As a student, I want to hand in work against an assignment.*

- I upload against a specific assignment
- I can see what I submitted and when

### US-S6 · Resubmit after corrections · Planned · FR-7
*As a student, I want to submit a corrected version without losing the original,
because my tutor is marking against both.*

- A resubmission creates a new version; nothing is overwritten
- Both versions remain visible to me and my tutor

### US-S7 · Keep my work private · Planned · NFR-1
*As a student in a group class, I want my classmates unable to see my work.*

- A student can read only their own submissions, even within a shared class
- Enforced server-side and covered by a negative test

---

## Both roles

### US-A1 · Reset a forgotten password · Built · FR-1
*As a tutor or student who has forgotten my password, I want to get back into my
account from my email, without asking anyone.*

- "Forgot password?" sits on the login form, where I notice the problem
- I get the same answer whether or not that address has an account, so the page
  cannot be used to find out who has one
- The emailed link takes me straight to a set-a-new-password form
- A used or expired link offers me a fresh one, never a login form I still can't use
- Setting a new password signs out every other session — if someone else was in
  my account, the reset actually removes them

---

## Story → requirement coverage

| Story | Requirement | Status |
|---|---|---|
| US-T1, US-S1, US-A1 | FR-1 Accounts and roles | Built |
| US-T2, US-T5 | FR-2 Classes | Built |
| US-T3, US-T4, US-S1, US-S2 | FR-3 Invitations | Built |
| US-T6, US-T7, US-S3 | FR-4 Sessions | Built |
| US-T8, US-S4 | FR-5 Materials | Built |
| US-T10 | FR-6 Assignments | Planned |
| US-T11, US-T12, US-S5, US-S6, US-S7 | FR-7 Submissions | Planned |
| US-T13 | FR-8 Profiles | Partial |
| US-T9 | NFR-1, NFR-2 | Built |

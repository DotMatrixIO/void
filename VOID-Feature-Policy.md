# THE VOID FEATURE POLICY

**What we will and won't build.**

"Could you add just one more thing?" someone might say. (A little chat panel. A file upload button. A dashboard for the dashboard.)

This is how a tool becomes a platform, how a room becomes a building.

But VOID is not a building. VOID is definitely a room. It's a small temporary room where a few people can meet in real time and leave less behind than they would elsewhere.

So, we needed a rule. **RULE: We will add features that increase live presence and reject features that create lasting artifacts.**

Everything below is just that idea wearing work clothes.

---

## HOW WE DECIDE

A feature is a good fit for VOID if it does most of the following:

- Helps people communicate live, right now
- Disappears when the room disappears
- Does not require accounts, profiles, or identity
- Does not create archives, exports, or storage obligations
- Keeps the system legible to an ordinary person
- Does not force the server to know more than it needs to know
- Does not make VOID feel like a worse Zoom

If a feature fails those tests, it does not belong here.

---

## THE THREE COLUMNS

| ALIGNED | MAYBE | NOT VOID |
|---------|-------|----------|
| Strengthens live presence without creating residue | Useful, but only if sharply constrained | Creates artifacts, persistence, bureaucracy, or platform creep |

---

## ALIGNED

These features fit the product as it exists today. They make the room work better without changing what the room is.

### SCREEN SHARING

Live, intentional, temporary. This is the strongest candidate for expansion because it still belongs to the same species as conversation.

But it must remain disciplined:

- One active screen share at a time
- Tab/window sharing preferred over full desktop
- Obvious "you are sharing" indicator
- Simple pause/stop controls
- No recording, no snapshots, no export
- Ideally presenter-first, not chaos-first

A person choosing to reveal a screen in real time is still participating in an ephemeral conversation. That is acceptable.

### SPEAKING INDICATORS

A small visual signal showing who is currently talking. Useful. Temporary. Leaves no trace.

### RAISE HAND

A polite little interruption request. Human beings have been doing this for centuries. We see no reason to improve dramatically on the gesture.

### QUICK REACTIONS

A nod, a checkmark, a small burst of acknowledgment. If it vanishes quickly and is not stored, it is fine.

### PRESENTER / SPOTLIGHT MODE

For small-group discussions where one person is sharing a screen or leading a conversation. This improves clarity without creating records.

### CONNECTION QUALITY INDICATORS

People like to know whether the problem is their microphone, their network, or God. A simple signal helps.

### SESSION COUNTDOWN / TIME REMAINING

Rooms are temporary by design. Showing people how much time remains is honest and useful.

### DEVICE CHECKS AND LIVE CONTROLS

Mic meter. Camera preview. Output device switch. Things that help the conversation happen without adding residue to the world.

### MORE LOCAL MASKS, FILTERS, AND LIVE MEDIA CONTROLS

If processing happens locally and vanishes with the room, it fits. More shader modes, more voice masks, better on-device controls — all of that strengthens the same core idea.

> **Note on the ALIGNED column:** ALIGNED means philosophically consistent with VOID's model. It does not mean scheduled, committed, or on any timeline. These features are approved in principle — they would not corrupt the product if built well. They will be built if and when they serve the product, not because they appear on a list. Some of these (screen sharing, session countdown) are near-term candidates. Others (raise hand, quick reactions, spotlight mode) are further out and may never be prioritized if the product doesn't need them. Appearing in ALIGNED is permission, not a promise.

---

## MAYBE

This is the smallest column on purpose.

Not forbidden, but dangerous. If we build these features, they must remain temporary and limited.

### EPHEMERAL NOTES

Not "chat" in the usual sense. That word carries baggage: history, scrollback, expectations, archives.

Perhaps something smaller though:

- Memory only
- Room-scoped only
- Hard-capped buffer
- No persistence
- No attachments
- No replay after reconnect beyond a tiny recent window, if that
- Gone when the room ends

It should probably be called Notes or Link Drop, not Chat. Because things become what you call them.

### PRESENTATION AIDS DURING SCREEN SHARE

A temporary pointer. A simple highlight. Maybe a live laser-pointer equivalent.

Only if:

- It is real-time only
- It is not saved
- It does not become a whiteboard
- It does not become collaborative document editing wearing a fake mustache

You get the idea.

If a feature improves usability and vanishes completely when the browser tab vanishes, does the feature still make sense? If yes, then perhaps.

---

## NOT VOID

This is the important column.

These are not "later." These are the features that would change the species of the product.

Once you build enough of these, VOID stops being VOID and becomes office software with a privacy haircut.

### FILE TRANSFER

No.

Files are artifacts. Artifacts persist. They carry metadata, create forensic residue, and train users to think of the room as a storage channel rather than a temporary meeting place.

If you need to show a document, share your screen. If you need to transfer a file, use something else.

### DOCUMENT UPLOADS

Also no.

Uploads imply previews, retries, storage semantics, lifecycle questions, and eventually the sentence: "Where is this kept?" We do not want that sentence anywhere near this product.

### PERSISTENT CHAT

No.

A persistent chat log is a second product hiding inside the first one. It brings expectations of history, search, recovery, and cross-session identity. That is another road, and it goes somewhere we do not want to live.

### RECORDING

Absolutely not.

A room that records itself is not ephemeral. It is a trap with a progress bar.

### TRANSCRIPTION

No.

Even without recording, transcription creates durable textual artifacts out of temporary speech. The residue is the problem, not merely the medium.

### AI SUMMARIES, ACTION ITEMS, MEETING NOTES

No.

The whole point of VOID is that a conversation can happen and then be over. Turning speech into an extractable work product is exactly the opposite of that.

### WHITEBOARDS WITH SAVE / EXPORT

No.

A whiteboard that evaporates instantly might sound charming, but in practice users will demand save, export, restore, share, and eventually version history. We have seen how this movie ends.

### BREAKOUT ROOMS

No.

VOID is for small rooms. Once you need room hierarchies, orchestration, and sub-meeting topology, you are solving a different problem for a different audience.

### POLLS, QUIZZES, WEBINAR TOOLS

No.

These are meeting-management features for institutions. VOID is not an institution. It is a room.

### ATTENDANCE REPORTS, ANALYTICS, ADMIN DASHBOARDS

No.

Nothing good follows the sentence "Could we get some analytics on participant behavior?"

### USER ACCOUNTS, PROFILES, CONTACTS, FRIEND LISTS

No.

No identity layer. No social graph. No recent contacts. No cross-room persistence. No professional networking in a trench coat.

### CALENDAR INTEGRATIONS, SCHEDULED ROOMS, RECURRING EVENTS

No, or close enough to no that it makes no practical difference.

A temporary room should not develop a future tense.

### LARGE-MEETING / WEBINAR FEATURES

No.

VOID is not for 50 people. It is not for 500. It is for a few people who mean to be there.

### COMPLIANCE EXPORTS, MODERATION ARCHIVES, E-DISCOVERY

No.

If a feature exists mainly to help institutions retain and inspect what happened in the room, it belongs to another universe.

---


---

## THE RULE ABOUT MAYBES

Features do not stay in the MAYBE column automatically.

A MAYBE feature moves to NOT VOID the moment it requires any of the following:

- Persistent storage
- Export
- Attachments
- User accounts
- Cross-session identity
- Searchable history
- Administrative oversight
- Server-side retention of room content
- "Enterprise requests"
- A product demo involving the phrase "knowledge workers"

That last one is not a joke.

---

## WHAT THIS MEANS FOR THE ROADMAP

If we build further, the likely order is simple:

**LIKELY**
- Screen sharing
- Better presenter controls
- Better live room-state indicators
- More local masking and media controls

**POSSIBLE, IF HEAVILY CONSTRAINED**
- Ephemeral notes / link drop
- Tiny live presentation aids

**NOT UNDER CONSIDERATION**
- File transfer
- Persistent messaging
- Recording
- Transcription
- AI summaries
- Office-suite behavior of any kind

---

## THE PHILOSOPHY IN ONE SENTENCE

VOID should become the best possible tool for short-lived, high-trust, low-residue live conversations between a few people.

Not a better Meet for everyone.

Not a collaboration suite.

Not a workplace operating system.

A room.  A room that does not remember you after you leave it.
---

*This document is the canonical feature policy for VOID. It should be consulted before any feature decision and treated as binding unless explicitly revised.*

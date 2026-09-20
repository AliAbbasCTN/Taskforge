# Phase 03 — Authentication: Concepts

## Authentication vs. Authorization

**Authentication** answers "who are you?" — proving identity, typically via a password. **Authorization** answers "what are you allowed to do?" — once we know who you are, deciding what you can access.

This phase builds authentication: register, login, and proving identity on later requests via a token. **Authorization stays coarse for now** — the only rule is "you can edit your own account" (a basic resource-ownership check). Real role-based authorization (admins, managers, per-organization permissions) is Phase 06's job, once Phase 04 gives us organizations to scope permissions to. Building full RBAC before multi-tenancy exists would mean building it twice.

## Why Hash Passwords At All

**WHAT:** Hashing is a one-way transformation — you can turn a password into a hash, but you cannot turn a hash back into the password.

**WHY:** If TaskForge's database were ever breached, storing plaintext passwords would hand the attacker every user's real password directly — and because people reuse passwords across sites, that breach cascades into their email, banking, etc. Storing only a hash means the attacker gets something that's designed to be extremely expensive to reverse.

**WHY bcrypt specifically, and not something like SHA-256:** general-purpose hashes like SHA-256 are *fast* — that's exactly what you don't want for passwords. A fast hash lets an attacker with a stolen hash try billions of guesses per second on ordinary hardware. bcrypt is deliberately, tunably slow (the "cost factor" — we use 12 rounds) and includes a random salt automatically, so identical passwords produce different hashes and pre-computed "rainbow table" attacks don't work.

**Where this project deviates from convention:** we used `bcryptjs` (a pure-JavaScript implementation) rather than the more common `bcrypt` package (which wraps a native C++ binding). `bcrypt` requires a working native build toolchain (Python, a C++ compiler) to install, which is a common source of broken `npm install` on Windows machines with no toolchain configured. `bcryptjs` is slightly slower but has an identical API and produces fully compatible hashes — a reasonable trade for removing that entire class of setup friction from a learning project.

## JWTs: Access Tokens vs. Refresh Tokens

**WHAT:** A JWT (JSON Web Token) is a signed piece of data — three base64url-encoded segments (header, payload, signature) — that a server can verify wasn't tampered with, without needing to look anything up in a database.

**WHY two tokens instead of one:**
- An **access token** is attached to every API request (`Authorization: Bearer <token>`) and is deliberately **short-lived** (15 minutes here). If one is ever stolen, the window an attacker can use it in is small.
- A **refresh token** is only ever sent to one endpoint, `/auth/refresh`, to obtain a new access token once the old one expires. It's **long-lived** (7 days), because otherwise the user would have to log in with their password every 15 minutes — but that long lifetime is exactly why it needs extra protection (rotation and hashed storage, both explained below).

**Why not just use one long-lived token everywhere?** Because then every single API request would carry a credential valuable enough to impersonate the user for a week, instead of only the one narrow endpoint (`/auth/refresh`) carrying that risk.

## Refresh Token Rotation

**WHAT:** Every time `/auth/refresh` is used, the old refresh token is invalidated and a brand new one is issued — the client must save the new one and discard the old one.

**WHY:** Without rotation, a stolen refresh token remains valid for its entire 7-day lifetime with no way to detect the theft. With rotation, if an attacker ever steals and uses a refresh token, the legitimate user's *next* refresh attempt will fail (their token was already replaced by the attacker's use of it) — a visible signal something is wrong, rather than silent, ongoing access. Full theft-detection systems go further (tracking token "families" to immediately revoke every descendant token on detected reuse) — we don't build that here, but the rejection-on-reuse behavior is the foundation it would be built on.

## A Real Bug We Hit: Why Refresh Tokens Are Hashed With SHA-256, Not bcrypt

This is worth walking through in detail because it's exactly the kind of subtle bug that ships to production if you don't have tests that actually exercise it.

The first implementation stored the refresh token's hash using bcrypt — the same tool used for passwords, on the reasoning "it's a secret, so hash it the same way." The **end-to-end test for token reuse failed**: a rotated (stale) refresh token was being accepted as valid.

**The cause:** bcrypt silently truncates its input at 72 bytes. A JWT is much longer than that. Two tokens issued for the *same user* moments apart share an identical header and the start of their payload (`sub`, `email`) — the parts that differ (`jti`, `iat`, `exp`, the signature) all appear *after* byte 72. So `bcrypt.compare(oldToken, hash(newToken))` was comparing only the identical first 72 bytes of both tokens and reporting a match, even though the tokens were completely different strings.

**The fix:** hash refresh tokens with SHA-256 instead — a general-purpose hash with no length limit — and compare using `crypto.timingSafeEqual` (constant-time comparison, so an attacker can't extract information from how long the comparison took). bcrypt's slowness is specifically valuable for low-entropy, human-guessable secrets like passwords; a refresh token is already a long, random-looking signed value, so there's no brute-forcing risk to slow down, and bcrypt's length limit becomes a pure liability with no offsetting benefit.

**The lesson:** hashing is not one-size-fits-all — the right hash function depends on what you're hashing and what property you actually need (slow-and-salted for guessable secrets, fast-and-unlimited-length for high-entropy ones). This is also the concrete reason `docs/api-conventions.md`'s testing philosophy insists on tests that exercise real behavior end-to-end: a mocked-out unit test of "tokens rotate" would have happily passed while this bug shipped, because the mock wouldn't have reproduced bcrypt's actual truncation behavior. The e2e test, running against the real `bcryptjs` and comparing real JWT strings, is what caught it.

## Generic Error Messages (Preventing User Enumeration)

Login failure returns the identical message — `"Invalid email or password"` — whether the email doesn't exist or the password is wrong. If these returned different messages, an attacker could feed a list of email addresses to the login endpoint and learn exactly which ones have accounts on TaskForge, without ever knowing a password. This is a real, common vulnerability class (user enumeration) and the fix costs nothing in legitimate usability.

## Why `JwtStrategy` Doesn't Query the Database on Every Request

`JwtStrategy.validate()` only decodes what's already inside the verified token payload (`id`, `email`) — it does not look the user up in the database. The alternative (a database read on every single authenticated request) would add real latency and load for information that's already sitting, verified, in the token. The accepted trade-off: if a user is deleted, their still-valid access token continues to work until it naturally expires — at most 15 minutes. Given how short-lived access tokens are, that's a deliberate, reasonable trade, not an oversight. `GET /auth/me` exists specifically for when a client needs a guaranteed-fresh read of the user's current data.

## Why Sensitive Fields Are Never `SELECT`-ed, Not Just Hidden

`UsersService.findAll()` and `findOne()` use Prisma's `select` to fetch *only* `id`, `email`, `name`, `createdAt`, `updatedAt` — the password hash and refresh token hash are never pulled from the database for these queries at all, rather than being fetched and then stripped out afterward. This matters: a field that is never fetched cannot leak through some later bug (a forgotten `console.log`, an incomplete serializer, a future teammate spreading `...user` into a response). The only two places that ever read `passwordHash` or `hashedRefreshToken` are two narrowly-scoped, explicitly-named methods (`findByEmailForAuth`, `findByIdWithRefreshHash`) used exclusively by `AuthService`.

## Why `POST /users` Was Removed

Phase 02 had a public `POST /users` endpoint for creating a user record with no password at all — reasonable at the time, since accounts didn't have passwords yet. Now that they do, an endpoint that creates a full account with no credential would be a serious hole: anyone could create accounts for other people's email addresses. Account creation now happens exclusively through `POST /auth/register`, which owns password hashing from the start. This was flagged and fixed as part of this phase rather than left as an inconsistency.

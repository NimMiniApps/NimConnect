# NimConnect — Mini Apps Competition Scoring Assessment

**Source rubric:** [miniappscompetition.com/scoring](https://miniappscompetition.com/scoring)  
**Assessed:** 2026-07-17 · **Re-evaluated:** 2026-07-18  
**App:** [NimConnect](https://nimconnect.nimiqminiapps.com) · catalog slug `nimconnect` · status **approved / featured / released**  
**Assessor note:** Unofficial self-score against the published 105-point guide. Final scores are decided by Nimiq Community Council Members.

---

## Delta since first assessment (2026-07-17 → 2026-07-18)

Product work landed that directly targets prior Design/UX and completeness gaps. Catalog packaging and measurable distribution did **not** move.

| Shipped | Scoring impact |
|---|---|
| **Identity setup guidance** on Home (`IdentitySetupCard`: claim → share → first contact, celebration, snooze) | Closes the “guided first win” gap; lifts **Onboarding** and **Navigation** |
| **Smarter Home / Split empty CTAs** (people-first Split empty state) | Reinforces first-open clarity without a wizard |
| **Desktop identity portal** (Hub claim/publish, marketing home, lookup, My Identity, About) | Stronger browser first impression, ecosystem story, and completeness; new acquisition surface |
| **Profile-client / claim payload** maturity (already in flight pre-assessment, still compounding) | Keeps **Ecosystem value** and **Nimiq integration** at Outstanding |

| Still open after 2026-07-18 catalog refresh | Evidence |
|---|---|
| Catalog `socials` | Still empty (no verified social URLs) |
| Real product screenshots / demo video | Banner shipped; phone UI screenshots + video still missing |
| Reviews / ratings | `0` reviews, `0` avg rating |
| Unique-wallet tally | Not evidenced |

**Catalog refresh (2026-07-18):** `release_stage` → **released**, banner + media gallery seeded, copy updated for desktop Hub portal + guided identity setup.

**Net:** product quality moved up ~3–5 points; Marketing upside is now screenshots/demo + unique users + socials/ratings, not empty packaging.

---

## How scoring works

| Block | Points | Criteria |
|---|---:|---|
| Design & UX | 25 | 5 criteria |
| Functionality | 25 | 5 criteria |
| Usefulness & originality | 25 | 5 criteria |
| Marketing & distribution | 25 | 5 criteria |
| Bonus (NIM usage) | 5 | 1 criterion |
| **Total** | **105** | **21 scored elements** |

Each criterion is judged on the official performance scale:

| Level | Meaning |
|---|---|
| Outstanding (5) | Exceptional; sets the bar |
| Strong (4) | Polished, thoughtful, exceeds expectations |
| Competent (3) | Functional, meets the standard |
| Developing (2) | Effort shown, falls short |
| Insufficient (1) | Bare minimum |
| Not demonstrated (0) | Missing / non-functional |

Assumption used here: each of the 20 main criteria is worth **up to 5 points**, so category totals land on 25.

Official framing from the site:

> Don’t just build. Ship something polished, tell the story of what you built, get real people to use it, and show up in the community. Builders who treat this as “build and forget” will score lower than builders who actively engage.

---

## Headline estimate

| Category | Was (07-17) | Now (07-18) | Band |
|---|---:|---:|---|
| Design & UX | 19 | **21 / 25** | Strong |
| Functionality | 21 | **22 / 25** | Strong → Outstanding |
| Usefulness & originality | 22 | **23 / 25** | Strong → Outstanding |
| Marketing & distribution | 14–17 | **15–18 / 25** | Competent (community high; packaging + users still thin) |
| Bonus (NIM) | 5 | **5 / 5** | Outstanding |
| **Projected total** | ~81–84 | **~86–89 / 105** | Competitive for top-3 *if* unique users + catalog media catch up |

**Confidence range:** ~80–92 depending on how judges weigh unique wallets, demo/story assets, desktop-portal discovery, and whether Skool presence is visible to the Council.

---

## 1. Design & UX — ~21 / 25 *(was ~19)*

| Criterion | Official question | Score | Δ | Why |
|---|---|---:|---:|---|
| First impression | Look professional and trustworthy at first glance? | **4 Strong** | — | Mini App + desktop marketing home both read as a real Nimiq product. Catalog now shows **released** + banner; real phone screenshots would push this toward Outstanding. |
| Visual design | Colors, typography, layout clean and consistent? | **4 Strong** | — | Nimiq tokens / Mulish / identicons; desktop portal polished to match public surfaces. Home can still densify once identity card + activity + inbox stack. |
| Navigation | New user can use it without instructions? | **4 Strong** | ↑ from 3 | Identity-setup card surfaces one next action (claim / share / add contact). Bottom nav breadth remains, but first open is no longer “five concepts at once with no priority.” |
| Mobile experience | Feels native and responsive on a phone? | **4 Strong** | — | Mobile-first Mini App unchanged; sheets, touch targets, Pay handoff. Desktop is now a deliberate identity shell, not a broken phone UI. |
| Onboarding | Zero → useful in under 60 seconds? | **4 Strong** | ↑ quality inside 4 | Name sheet + identity checklist get a user to a clear win (claim or first contact) quickly. Full “claim → pay someone” loop can still exceed 60s; celebration + share CTA help the middle. |

### What’s strong
- Looks like a real Nimiq product, not a generic crypto template.
- **Guided identity arc on Home** — claim → share → first contact — without a heavy wizard.
- Desktop portal gives browser visitors a trustworthy, on-brand first screen (“Claim your Nimiq identity”).
- Loading skeletons, sheets, milestone delight, and public landings show polish.

### What’s still lacking
- Catalog shelf assets so the *listing* first impression matches the product.
- Optional: one more cut of Home density once the identity card is complete (so returning users see people/activity first).

---

## 2. Functionality — ~22 / 25 *(was ~21)*

| Criterion | Official question | Score | Δ | Why |
|---|---|---:|---:|---|
| Core feature | Main function works reliably? | **4 Strong** | — | Contacts, send/request, split, invoices, buckets, public profiles remain real flows. Desktop Hub claim/publish extends identity without mocking payments. |
| Nimiq integration | Wallets / txs / payments core to the experience? | **5 Outstanding** | — | `@nimiq/mini-app-sdk` in Pay + **Nimiq Hub** on desktop for address/claim/`signMessage`; on-chain handles, signed backup, `nimiq:` links, explorer history. |
| Speed and performance | Loads fast, responds without lag? | **4 Strong** | — | Local-first IndexedDB; UI works offline for contacts. Network features poll / fetch with loading states. |
| Error handling | Fails gracefully vs crash/confuse? | **4 Strong** | — | Outside-Pay fallbacks, spendable-balance messaging, camera → paste degradation, restore paths; Hub install messaging on desktop. |
| Completeness | Finished product vs half-built prototype? | **5 Outstanding** | ↑ from 4 | Dual-surface identity (Pay + desktop Hub), ecosystem client, public APIs, and guided setup make this feel shippable. Catalog now signals **released**. |

### What’s strong
- Deep, honest Nimiq Pay *and* Hub integration (not logo-only).
- Local-first + optional cloud backup is production-minded.
- Ecosystem package (`@nimconnect/profile-client`) and public read APIs go beyond a single Mini App silo.

### What’s lacking
- Harden the Pay happy path (handle claim fee messaging, first Send) so judges never hit a confusing edge.
- Keep the live deploy rock-solid through Week 3 early access + judging.

---

## 3. Usefulness & originality — ~23 / 25 *(was ~22)*

| Criterion | Official question | Score | Δ | Why |
|---|---|---:|---:|---|
| Problem solved | Addresses a real need or want? | **5 Outstanding** | — | People remember people, not addresses — identity + relationship context on a wallet is a real gap. |
| Target audience | Clear who it’s for? | **4 Strong** | — | Desktop hero + catalog tagline sharpen “Nimiq identity / social payers.” One-line marketing outside the app could still be punchier. |
| Originality | Fresh idea or meaningful improvement? | **5 Outstanding** | ↑ from 4 | Handle + private notes + social payments + shared buckets + reusable identity APIs + **desktop Hub identity portal** is a distinctive stack, not “another tip jar.” |
| Repeat value | Open more than once? | **4 Strong** | — | Contacts, inbox requests, invoices, trip buckets, and activity invite return visits; identity checklist converts first open into habit-forming steps. |
| Ecosystem value | Makes Nimiq Pay more useful / attractive? | **5 Outstanding** | — | Public `@handle` pages, pay handoff, profile client, browser claim/lookup — infrastructure-shaped social UX. |

### What’s strong
- Fits the competition’s “Social / Productivity” idea space (group savings, tipping, invoicing, splitting).
- Separates public identity from private notes — a mature product stance.
- Other Mini Apps can reuse handles/profiles → compounding ecosystem value.
- Clear product story in-app and on desktop: *claim identity on desktop, use it everywhere in Nimiq Pay.*

### What’s lacking
- Proof of repeat usage (even anonymized): returning wallets, shared buckets completed, handles claimed.
- Optional: a tiny “share your `@handle`” viral loop that turns users into distribution (desktop share/QR helps; push it).

---

## 4. Marketing & distribution — ~15–18 / 25 *(was ~14–17)*

Still the softest category relative to product quality. Community presence and a better browser story help; measurable acquisition and catalog packaging remain the gaps.

| Criterion | Official question | Score | Δ | Why |
|---|---|---:|---:|---|
| Unique users | Distinct Nimiq wallets during scoring period? | **2 Developing** *(unknown)* | — | Catalog still **0 reviews / 0 rating**. Without a wallet-interaction count, assume weak unless you instrument/share numbers. |
| User acquisition effort | Promote beyond just submitting? | **3 Competent** | ↑ from 2–3 | Skool presence + desktop portal as a shareable claim/lookup URL improves the acquisition surface. External push (X, Telegram, short clips) still thinly evidenced. |
| Content and storytelling | Build log, demo video, compelling story? | **3–4 Competent → Strong** | ↑ | Catalog long description + desktop story + banner. Still missing: demo video and real UI screenshots. |
| Community engagement | Calls, progress, help others, show up? | **5 Outstanding** | — | Years of active Skool + community involvement — treat as a scoring asset. |
| Submission quality | App-store ready packaging? | **4 Strong** | ↑ from 3 | Featured, **released**, banner/media, clear copy, GitHub + live domain. Remaining gaps: socials, screenshots, ratings. |

### What’s strong
- **Skool / community:** long-term presence — differentiator vs “build and forget.”
- Catalog copy + desktop marketing home tell a coherent identity story.
- Featured placement, reachable production domain, Hub-claimable desktop path for friends who aren’t in Pay yet.

### What’s lacking (highest leverage)
1. **Demo video / walkthrough** (rules explicitly say optional but helps storytelling).
2. **Real screenshots in catalog `media`** — home + identity card, contact pay, `@handle` page, desktop claim, split/bucket (banner is done).
3. **Unique-user proof:** track distinct wallets during the scoring window; post progress in Skool.
4. **Acquisition push:** invite friends via desktop claim URL + Pay open link; short X/Forum posts.
5. **Social proof:** catalog ratings during Week 3 early access.
6. **Socials on the listing** when you have stable X/Telegram/etc. URLs.

---

## 5. Bonus — NIM usage — **5 / 5**

| Criterion | Official question | Score | Why |
|---|---|---:|---|
| NIM usage | Incentivize usage of NIM? | **5 Outstanding** | Core loop is send / request / tip / split / invoice / bucket contributions in **NIM**; handle claims consume NIM fees (Pay and Hub paths). FAQ: apps that incentivize NIM get up to 5 bonus points. |

No USDT dependency required for qualification; NIM-native is a scoring advantage here.

---

## Scorecard snapshot

```
Design & UX ................ 21 / 25   (was 19)
Functionality .............. 22 / 25   (was 21)
Usefulness & originality ... 23 / 25   (was 22)
Marketing & distribution ... 17 / 25   (mid of 15–18 after catalog refresh; was ~15)
Bonus (NIM) ................  5 /  5
────────────────────────────────────
Projected total ............ 88 / 105  (was ~82)
```

### If marketing catches up

| Scenario | Marketing | Total |
|---|---:|---:|
| Current (banner + released; screenshots/users thin) | 17 | **~88** |
| + demo video + real screenshots + socials | 20 | **~91** |
| + measurable unique wallets + ratings | 22–24 | **~93–95** |

That last band is where first/second place becomes realistic against other polished entries.

---

## Priority gaps (do these next)

Ordered by expected score impact per effort. Items closed since 07-17 are struck through for history.

1. **Ship a 60–90s demo video** — problem → `@handle` → pay/split → private notes stay local; include a beat of desktop claim if useful.
2. ~~**Fill catalog packaging**~~ — **Done for shelf basics:** banner, released stage, refreshed copy. Still add real screenshots + socials.
3. **Drive and count unique wallets** — Skool friends + Sip & Ship testers; report numbers publicly.
4. **Week 3 early-access campaign** — ask for feedback + ratings; fix whatever breaks under real use.
5. ~~**Tighten first-run UX**~~ — **Done:** identity-setup card + smarter empty CTAs (claim → share → first contact).
6. **Publish the story** — short build thread: why NimConnect exists, Skool journey, privacy stance, desktop + Pay dual surface, ecosystem client.
7. **Keep it alive** — uptime through judging; one meaningful post-submit update if you’re in prize contention.
8. **Add 3–6 real screenshots** to catalog `media` (Home identity card, pay, public `@handle`, desktop claim).

---

## What already scores well (don’t under-sell)

- Real Mini App, not a prototype — live domain, MIT GitHub, featured catalog entry.
- Deep NIM + Nimiq Pay (+ Hub on desktop) integration → Functionality + Bonus.
- Clear ecosystem thesis (identity layer others can reuse).
- Privacy architecture that builds trust (local notes, selective public fields).
- **Guided identity setup** — judges can see a deliberate first-win path.
- **Desktop identity portal** — browser-ready claim/lookup/story surface.
- **Long-term Skool / community engagement** — rare among submissions and directly scored under Marketing.

---

## Evidence checklist for judges / submission packet

Use this as a packaging checklist before final submission / early access:

- [ ] Demo video linked from README + Skool post + catalog description
- [x] Banner uploaded to catalog (`banner_url` + `media`)
- [ ] Real phone/desktop screenshots added to catalog `media`
- [ ] Social links filled (`socials`) when URLs are ready
- [x] One-paragraph “who it’s for” + “how Nimiq Pay / Hub is used” in catalog long description
- [x] Catalog `release_stage` set to **released**
- [ ] Unique-wallet count for the scoring window (even a screenshot of analytics / honest Skool tally)
- [ ] 3+ real user quotes or catalog ratings
- [ ] List of Skool / Sip & Ship contributions (help threads, feedback rounds, progress posts)
- [ ] Confirm live URL + GitHub + MIT license on the submission form
- [x] First-run identity guidance shipped in product
- [x] Desktop identity portal live (claim / lookup / about)

---

## Disclaimer

This is an internal estimate grounded in the published rubric and the current product/catalog state. Council scoring can diverge — especially on **unique users** and **storytelling**, which are hard to infer from code alone. Product improvements since 07-17 mainly lift Design, Completeness, and Originality; treat **Marketing packaging + wallet proof** as the remaining controllable upside before judging closes.

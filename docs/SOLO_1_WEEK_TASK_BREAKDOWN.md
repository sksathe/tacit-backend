# Tacit Solo 1-Week Task Breakdown (Shippable + Looks Great)

## Scope and assumptions

- Developer count: 1 (you)
- Sprint length: 5 working days
- Capacity: ~40 hours total
- Manager priority order:
  1. Agent workflow creation (primary)
  2. Web meeting functionality (also primary)
  3. Enhancing existing features (secondary)
- Ship target: a demo-ready product that is visually polished and coherent with PRD (SAGE/RELAY/SCOUT)

---

## Current baseline

### Already working

- Phone-first session flow through MCP
- Invitee verification + session persistence
- Dashboard/session detail + automation output surfaces

### Gap to manager goal

- Agent workflow is not formalized as PRD-style mission workflow
- Web meeting flow is not first-class in product UX
- Existing UX has rough edges that reduce "looks great" perception

---

## This week priorities

## P1: Agent workflow creation

### 1) PRD agent framework in product (SAGE/RELAY/SCOUT)

- Work:
  - Replace current default agent model with PRD agent profiles
  - Add role, tone, languages, and domain metadata
  - Update picker cards to show mission-fit clearly
- Shippable output:
  - Product experience reflects PRD agents directly

### 2) Mission templates v1 (agent-specific)

- Work:
  - Add template set per agent (3 starter missions each)
  - Store selected mission with meeting/session
  - Inject mission context into agent instructions/hints
- Shippable output:
  - Real mission-driven workflow (not just free-text agenda)

### 3) Guided workflow UI

- Work:
  - Build clean step flow: Choose Agent -> Choose Mission -> Configure Session -> Review
  - Improve typography, spacing, hierarchy, and CTA clarity
  - Add polished success and empty states
- Shippable output:
  - A clear, premium-feeling setup experience for demos and pilots

## P2: Web meeting functionality (MVP)

### 4) Web meeting mode and platform selection

- Work:
  - Add meeting mode: `phone` or `web`
  - Add platform selector: Zoom / Teams / Google Meet
  - Add link validation and persistence
- Shippable output:
  - Users can create web meetings natively in product

### 5) Web meeting join flow and invite updates

- Work:
  - Show "Join Web Meeting" CTA in session detail/list
  - Include web meeting instructions/link in invite emails
  - Ensure API payloads and UI read paths support web metadata
- Shippable output:
  - End-to-end web meeting scheduling and join UX is live

## P3: Repo split + separate deployment

### 6) Split code into separate repositories and deploy independently

- Work:
  - Split into at least:
    - `tacit-frontend` (UI)
    - `tacit-api` (REST API)
    - `tacit-mcp-agent` (MCP service)
  - Set up independent deployment pipelines/environments per service
  - Configure frontend -> API base URL and API -> MCP/infra environment linkage
  - Validate CORS/env vars/secrets for cross-service connectivity
- Shippable output:
  - Services are independently deployable with working API connectivity between them

## P4: Enhance existing features

### 7) Reliability + polish pass on current flows

- Work:
  - Tighten transcript/finalize error states
  - Remove production mock fallback where it masks failures
  - Improve loading/empty/error states
- Shippable output:
  - Existing behavior feels more stable and production-safe

## Day-by-day plan (solo)

- Day 1 (Mon): Task 1 + start Task 2 + start Task 6 (agent workflow + repo split)
- Day 2 (Tue): finish Task 2 + finish Task 6 (agent workflow + separate deploy + API connectivity validation)
- Day 3 (Wed): Task 4 (end-to-end web meeting flow, link validation/persistence)
- Day 4 (Thu): Task 5 (web meeting join CTA, invite updates, web meeting mode)
- Day 5 (Fri): Task 3 + Task 7 (UI changes, visual enhancement, reliability polish) + final smoke test

---

## End-of-week ship definition

- SAGE/RELAY/SCOUT are first-class selectable agents with mission context
- Guided setup workflow feels polished and demo-ready
- Web meeting sessions can be created, invited, and joined from product UX
- Frontend, API, and MCP are split/deployed independently with verified API connectivity
- Existing phone flow remains functional; reliability polish is secondary if schedule permits

---

## Explicit scope note (to stay realistic)

- This week delivers **web meeting functionality MVP** (create/manage/join-link workflow).
- Full autonomous agent participation inside Zoom/Teams/Meet (SDK/API bot join behavior) should be planned as next sprint scope.

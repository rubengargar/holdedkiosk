# Holded Kiosk

A kiosk for clocking employees in and out of Holded. Workers tap their name to clock in or out. A Vue 3 frontend talks to a Cloudflare Worker, which proxies the Holded API.

## Screenshot

![Holded Kiosk Screenshot](/screenshot.png)

## Security note

Holded API tokens are stored in the browser's `localStorage`, one per company, in plain text. There is no PIN or password protecting them, so anyone with access to the kiosk browser can read them. Use tokens with only the scopes listed below, and run the kiosk on a device you control.

The worker does not store tokens. The browser sends the token of the active company in the `X-Holded-API-Key` header on each request, and the worker forwards it to Holded as a Bearer token. The worker returns only employee id and name, never the other employee fields Holded stores (IBAN, social security number, salary, address).

## Features

*   Several Holded companies on one kiosk. Round avatars at the top left of the header switch between them with one tap, even with a single company. Each company keeps its own employee list, hidden employees, logo and loaded data.
*   Automatic company name and logo. The worker reads them from Holded (`GET /api/account`) and returns only `name` (the trade name when set) and `logoUrl`. The logo is shown in the avatar and is never uploaded by hand. Without the optional `account:info.read` scope, or when Holded has no logo or the image fails to load, the avatar shows the company's initials on a colour derived from its id. The name field when adding a company is optional: a name you type always wins, an empty one takes the Holded name, and "Empresa N" is the fallback. The logo URL is built from a path that Holded returns, on `app.holded.com`. That host is observed behaviour, not documented.
*   Per-company settings. The settings panel shows only the active company: rename, "Actualizar datos de Holded", token, hide/show employees and delete. Switch to another company to edit it. A separate "Kiosko" section holds the kiosk title and "Añadir empresa".
*   Lists employees with an active contract and no termination date.
*   Hide employees, per company.
*   Change the Holded token of a company from the settings panel. The new token is validated with one employee request before it replaces the old one, and the hidden employees are kept.
*   Clock-in, clock-out, pause and resume per employee, with the time tracked today. Time keeps counting while paused. A session that started before midnight (a night shift) counts only the hours since midnight in today's total.
*   A failed clock action shows its error until the next action or until it is dismissed, and refreshes that company's times once so the row reflects the real state.
*   Search, colored avatars, and a Todo / Dentro / Fuera summary.
*   Responsive layout for touchscreens such as an iPad Mini.
*   Legacy single-token installs (`holded_token`, `hidden_employee_ids` in `localStorage`) migrate to one company automatically.

### Holded API usage

Holded allows 100 requests per minute per API key. The kiosk keeps well under that:

*   The employee list is fetched when a company is added (this also validates the token), on first view after page load, when it is older than 15 minutes at poll time, and on the "Actualizar" button. It is not fetched on every poll.
*   Times are fetched with one request that returns all employees' entries for the day. The kiosk polls every 2 minutes, only for the active company and only while the page is visible. Switching company, returning to the page and polling refresh times only when they are older than 30 seconds.
*   The company name and logo are requested once when a company is added, once when its token is changed, once the first time an existing company without them is synced, and when you press "Actualizar datos de Holded" in its settings. Never on polls. A failure (for example a missing scope) never blocks adding the company, and it is not retried. The button refreshes the logo, and the name only while it is still an automatic "Empresa N".
*   Clocking in, out, pausing or resuming sends one request and no follow-up reads. The local state is updated from the result and the next poll reconciles it.
*   The tracked time shown on each row is computed in the browser once a minute.
*   On a 429 response the kiosk shows a message and keeps the data already on screen.

## Project structure

*   `frontend/`: Vue 3 + Vite + Tailwind app.
*   `worker/`: Cloudflare Worker that proxies the Holded API (v2).

## Prerequisites

*   [Node.js](https://nodejs.org/) 22.12 or later (required by the worker's Wrangler and Vitest).
*   A Holded account with an API key. The worker uses Holded API v2 and sends the key as `Authorization: Bearer <key>`. The key needs these scopes:
    *   `team:employees.read`
    *   `team:time-tracking.read`
    *   `team:time-tracking.write`
    *   `account:info.read` (optional): company name and logo. Without it the company shows its initials.

## Setup and deployment

### 1. Deploy the worker

```bash
cd worker
npm install
npx wrangler login
npm run deploy
```

Wrangler prints the worker URL, for example `https://holded-proxy-worker.your-subdomain.workers.dev`. The frontend needs it.

Set `ALLOWED_ORIGINS` in the `[vars]` block of the `wrangler.toml` at the repository root to the comma-separated list of origins that may call the worker. The worker answers CORS requests only for those origins. The default is `https://holdedkiosk.pages.dev,http://localhost:5173`. Add the origin where you host the frontend.

```toml
[vars]
ALLOWED_ORIGINS = "https://your-kiosk.pages.dev,http://localhost:5173"
```

There is one Wrangler config, `wrangler.toml` at the repository root, with `main = "worker/src/index.ts"`. Cloudflare Workers Builds reads it from the root, and the `dev` and `deploy` scripts in `worker/` pass `--config ../wrangler.toml` so they use the same file.

To deploy from Cloudflare Workers Builds, connect the repository and use these settings from the repository root:

```text
Root directory: /
Build command: None
Deploy command: npx wrangler deploy
Version command: npx wrangler versions upload
Production branch: main
```


### 2. Configure and build the frontend

```bash
cd frontend
npm install
cp .env.example .env
```

Set the worker URL in `frontend/.env`:

```bash
VITE_WORKER_BASE=https://holded-proxy-worker.your-subdomain.workers.dev
```

Build and deploy the `dist` folder to any static host. For Cloudflare Pages:

```bash
npm run build
npx wrangler pages deploy dist
```

## Local development against the mock

`worker/test/mock-holded.mjs` stands in for Holded, so you can develop without a real account. Any API key starting with `key-` is accepted by the mock.

```bash
# terminal 1: mock Holded on port 8788
node worker/test/mock-holded.mjs 8788

# terminal 2: worker on port 8787, pointed at the mock
cd worker
npm install
npx wrangler dev --config ../wrangler.toml --var HOLDED_API_BASE:http://127.0.0.1:8788

# terminal 3: frontend on port 5173
cd frontend
cp .env.example .env   # VITE_WORKER_BASE=http://localhost:8787
npm run dev
```

Add a company in the kiosk with a token such as `key-demo`. Use `key-other` for a second company.

Worker checks:

```bash
cd worker
npm test
npm run typecheck
```

Frontend checks:

```bash
cd frontend
npm test
npx vue-tsc --noEmit
npm run build
```

## Usage

1. Open the kiosk URL.
2. On first run, enter a company name and its Holded API token. The kiosk validates the token by loading the employee list.
3. Tap "Entrada" or "Salida" next to a name. While someone is clocked in, "Pausa" and "Reanudar" pause and resume their session.
4. Open the settings panel (gear icon) to rename, delete or change the token of companies, add another company, hide employees of the active company, or change the kiosk title.

## License

MIT, see [LICENSE](LICENSE).

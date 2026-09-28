# Top Tier Detailing — toptierdetailingok.com

Mobile detailing site for Carlos Jackson. One Cloudflare Worker serves the pages in `public/`
and the booking API in `src/worker.js`. Bookings live in the D1 database `top-tier-bookings`.

## Where things are
| What | File |
|---|---|
| Home page copy | `public/index.html` |
| Services, prices, time windows | `public/js/services.js` (booking page and server both read it) |
| Booking flow | `public/book.html`, `public/js/book.js` |
| Carlos's request screen (`/admin`) | `public/admin.html`, `public/js/admin.js` |
| Server / API | `src/worker.js` |
| Database tables | `migrations/` |
| Photos | `public/images/` (stock for now; swap in Carlos's work) |

## Settings (Cloudflare dashboard → Workers → toptierdetailing → Settings → Variables and secrets)
- `ADMIN_PASSWORD` (secret): Carlos's password for `/admin`.
- `NTFY_TOPIC` (secret, optional): a private topic name. When it's set, Carlos's phone gets
  a notification for every new request through the free ntfy app (ntfy.sh). Subscribe to the
  same topic name in the app.

## Local dev
```
npm install
echo "ADMIN_PASSWORD=test" > .dev.vars
npx wrangler d1 migrations apply top-tier-bookings --local
npx wrangler dev
```

## Deploy
Pushing to `main` deploys automatically once the repo is connected in Cloudflare
(Workers & Pages → Create → Import a repository). Build command: none. Deploy command: `npx wrangler deploy`.
Apply new database migrations with `npm run db:setup`.

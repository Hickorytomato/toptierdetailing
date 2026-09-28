# Top Tier Detailing — toptierdetailingok.com

Mobile detailing site for Carlos Landeros. One Cloudflare Worker serves the pages in `public/`
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

## Hosting
Lives in the Cloudflare **Pages** project `top-tier-detailing` (custom domains toptierdetailingok.com
and www). `src/worker.js` is bundled to `_worker.js` so Pages runs the API. Production bindings:
`DB` → D1 `top-tier-bookings`, secret `ADMIN_PASSWORD` (Carlos's /admin password), and service binding `MAILER` → Worker `ttd-mailer`
(`mailer/`), which emails new requests to Carlos (landeros14@icloud.com) via Cloudflare Email Routing.
Deploy the mailer with `cd mailer && npx wrangler deploy`.

Rollback: Cloudflare dashboard → Workers & Pages → top-tier-detailing → Deployments → pick an older one → Rollback.

## Deploy
```
export CLOUDFLARE_API_TOKEN=...   # "Edit Cloudflare Workers" token
npm run deploy
```

## Local dev
```
npm install
echo "ADMIN_PASSWORD=test" > .dev.vars
npx wrangler d1 migrations apply top-tier-bookings --local
npx wrangler dev
```

## To do
- Photos: `public/images/work/` (Carlos's, retouched, location data stripped). Hero reel: `public/images/hero/`. Logo: `public/logo.svg` (white), `logo-gold.svg`.
- Fill in the coating deposit amount in `public/js/admin.js` (search for `$__`).
- Email Routing must be enabled on toptierdetailingok.com and landeros14@icloud.com verified
  as a destination address, or new-request emails fail ("could not find account config").

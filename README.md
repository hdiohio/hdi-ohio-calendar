# HDI Ohio Calendar Helper

Cloudflare Pages project for `calendar.hdiohio.com`.

## Routes

- `/` — status shell
- `/health` — deployment health check
- `/event/:slug` — placeholder for the SilkStart event reader and calendar links

## Cloudflare Pages settings

- Framework preset: None
- Build command: leave blank
- Build output directory: `/`
- Root directory: `/`

The custom domain must be added in Cloudflare Pages before the Squarespace DNS CNAME is created.

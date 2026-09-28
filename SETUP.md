# Setup Worker

Yes — **separate buckets + separate subdomains** is the cleaner design.

```txt
assets.chornplanet.com  → public image bucket
data.chornplanet.com    → private/protected JSON bucket
```

This is better than mixing `/data` into the image bucket.

Cloudflare R2 buckets are private by default, but public access can be enabled through public bucket settings/custom domains. For protected JSON, keep the **data R2 bucket private** and expose it only through a **Cloudflare Worker** with an R2 binding and API-key check. Workers can access R2 directly via bindings. ([Cloudflare Docs][1])

## Final target architecture

```txt
Public images
https://assets.chornplanet.com/future-roadmap/era-01/desktop/xxx.webp
        ↓
R2 bucket: chornplanet-assets
        ↓
Public custom domain

Protected JSON
https://data.chornplanet.com/future-roadmap/era-01/en.json
        ↓
Cloudflare Worker checks x-api-key
        ↓
R2 bucket: chornplanet-data
        ↓
Private bucket
```

## Step 1 — Keep image bucket public

Existing URL remains:

```txt
https://assets.chornplanet.com/future-roadmap/era-01/desktop/era-01-3d-printed-buildings-become-mainstream.webp
```

Bucket:

```txt
chornplanet-assets
```

Domain:

```txt
assets.chornplanet.com
```

This bucket can remain public because it only stores images.

## Step 2 — Create a new private R2 bucket for JSON

Create a second R2 bucket:

```txt
chornplanet-data
```

Do **not** enable public access for this bucket.

Suggested object structure:

```txt
future-roadmap/era-01/en.json
future-roadmap/era-02/en.json
future-solutions/en.future-solutions.json
civilization-graph/en.page-index.json
civilization-graph/en.search-index.json
civilization-graph/en.sitemap.json
```

The final protected URL will become:

```txt
https://data.chornplanet.com/future-roadmap/era-01/en.json
```

No `/data/` prefix is needed because the whole subdomain is already data-only.

## Step 3 — Create a Cloudflare Worker

```bash
npm create cloudflare@latest chornplanet-data-api
cd chornplanet-data-api
```

Choose:

```txt
Worker
TypeScript
```

## Step 4 — Bind Worker to the private data bucket

`wrangler.toml`:

```toml
name = "chornplanet-data-api"
main = "src/index.ts"
compatibility_date = "2026-07-09"

[[r2_buckets]]
binding = "CHORN_DATA"
bucket_name = "chornplanet-data"
```

## Step 5 — Add API key secret

```bash
npx wrangler secret put CONTENT_API_KEY
```

Example secret value:

```txt
cp_live_xxxxxxxxxxxxxxxxxxxxxxxxx
```

This key should only be used from your **Next.js server**, never from browser/client-side code.

## Step 6 — Add Worker code

`src/index.ts`

```ts
export interface Env {
	CHORN_DATA: R2Bucket;
	CONTENT_API_KEY: string;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
		},
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		const apiKey = request.headers.get('x-api-key');

		if (!apiKey || apiKey !== env.CONTENT_API_KEY) {
			return jsonResponse(
				{
					error: 'Unauthorized',
				},
				401,
			);
		}

		const objectKey = url.pathname.replace(/^\/+/, '');

		if (!objectKey || objectKey.endsWith('/')) {
			return jsonResponse(
				{
					error: 'Missing JSON file path',
				},
				400,
			);
		}

		if (!objectKey.endsWith('.json')) {
			return jsonResponse(
				{
					error: 'Only JSON files are allowed',
				},
				400,
			);
		}

		const object = await env.CHORN_DATA.get(objectKey);

		if (!object) {
			return jsonResponse(
				{
					error: 'JSON file not found',
					key: objectKey,
				},
				404,
			);
		}

		return new Response(object.body, {
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'private, max-age=300',
				'x-content-source': 'cloudflare-r2',
			},
		});
	},
};
```

## Step 7 — Attach `data.chornplanet.com` to the Worker

Use a **Worker Custom Domain**:

```txt
data.chornplanet.com
```

Cloudflare Worker Custom Domains point the full domain/subdomain directly to a Worker, while Worker Routes are pattern-based. For this case, a Custom Domain is clean because all traffic on `data.chornplanet.com` should go through the Worker. ([Cloudflare Docs][2])

In Cloudflare:

```txt
Workers & Pages
→ chornplanet-data-api
→ Settings
→ Domains & Routes
→ Add
→ Custom Domain
→ data.chornplanet.com
```

## Step 8 — Upload JSON to the data bucket

Example:

```bash
npx wrangler r2 object put chornplanet-data/future-roadmap/era-01/en.json \
  --file ./data/future-roadmap/era01/en.era-01.json
```

Another example:

```bash
npx wrangler r2 object put chornplanet-data/civilization-graph/en.page-index.json \
  --file ./data/civilization-graph/pages/en.page-index.json
```

## Step 9 — Test unauthorized access

Open this in browser:

```txt
https://data.chornplanet.com/future-roadmap/era-01/en.json
```

Expected:

```json
{
	"error": "Unauthorized"
}
```

Good. This confirms protection works.

## Step 10 — Test authorized access

```bash
curl \
  -H "x-api-key: cp_live_xxxxxxxxxxxxxxxxxxxxxxxxx" \
  https://data.chornplanet.com/future-roadmap/era-01/en.json
```

Expected:

```json
{
  "era": "era-01",
  "items": [...]
}
```

## Step 11 — Use from Next.js server-side

Create:

```ts
// src/lib/content/fetchProtectedJson.ts

export async function fetchProtectedJson<T>(path: string): Promise<T> {
	const res = await fetch(`https://data.chornplanet.com/${path}`, {
		headers: {
			'x-api-key': process.env.CHORN_CONTENT_API_KEY!,
		},
		next: {
			revalidate: 300,
		},
	});

	if (!res.ok) {
		throw new Error(`Failed to fetch protected JSON: ${res.status}`);
	}

	return res.json() as Promise<T>;
}
```

Usage:

```ts
const era01 = await fetchProtectedJson('future-roadmap/era-01/en.json');
```

Add to `.env.local`:

```env
CHORN_CONTENT_API_KEY=cp_live_xxxxxxxxxxxxxxxxxxxxxxxxx
```

## Recommended final structure

```txt
R2 bucket: chornplanet-assets
Domain: assets.chornplanet.com
Access: public
Purpose: images, webp, png, thumbnails, OG images

R2 bucket: chornplanet-data
Domain: data.chornplanet.com
Access: private through Worker only
Purpose: JSON, search index, sitemap data, CGD page index
```

This is the correct production direction:

```txt
Images = public CDN asset layer
JSON = protected content/data API layer
Next.js = server-side consumer
Worker = authorization gateway
R2 = storage
```

[1]: https://developers.cloudflare.com/r2/api/workers/workers-api-usage/?utm_source=chatgpt.com 'Use R2 from Workers'
[2]: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/?utm_source=chatgpt.com 'Custom Domains · Cloudflare Workers docs'

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

		const headers = new Headers();

		headers.set("content-type", "application/json; charset=utf-8");
		headers.set("cache-control", "private, max-age=31536000, immutable");
		headers.set("etag", object.httpEtag);
		headers.set("x-content-source", "cloudflare-r2");

		return new Response(object.body, {
			headers,
		});
	},
};

# VHJS framework recipes

These recipes show the boundary between an HTTP application and VHJS. They are
not part of the `@primemb/vhjs` package and they do not add a framework dependency to the
library. Copy the recipe for the framework already used by your application.

| Recipe | Install in the host application | What it demonstrates |
| --- | --- | --- |
| [`express/server.ts`](./express/server.ts) | `pnpm add express @primemb/vhjs` | JSON API, SSE progress, static HLS files |
| [`fastify/server.ts`](./fastify/server.ts) | `pnpm add fastify @fastify/static @primemb/vhjs` | JSON API and static HLS files |
| [`nestjs/main.ts`](./nestjs/main.ts) | `pnpm add @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs @primemb/vhjs` | provider/controller split and static HLS files |
| [`nextjs/`](./nextjs) | `pnpm add next react react-dom @primemb/vhjs` | App Router API routes, SSE progress, public HLS files |

The TypeScript project intentionally excludes this directory from its root
typecheck: each recipe imports optional dependencies belonging to the consuming
application. Once copied, that application's normal typecheck validates it.

## Shared HTTP contract

All server recipes accept this request:

```http
POST /transcodes
content-type: application/json

{ "input": "/absolute/path/to/input.mp4" }
```

They return `{ "id": "...", "playlistUrl": "/hls/<id>/master.m3u8" }`.
The job is intentionally asynchronous. In the Express and Next.js recipes,
connect to `GET /transcodes/<id>/events` and handle the SSE events `progress`,
`complete`, and `failed`.

```ts
const events = new EventSource(`/transcodes/${id}/events`);
events.addEventListener("progress", ({ data }) => renderProgress(JSON.parse(data)));
events.addEventListener("complete", () => events.close());
events.addEventListener("failed", ({ data }) => showError(JSON.parse(data).message));
```

For browser uploads, store the upload first and pass the server-side file path
to VHJS. Do not accept arbitrary filesystem paths from an untrusted client as a
production API design.

## Production notes

- Put authentication, authorization, input validation, file-size limits, and
  per-user/concurrent-job quotas in front of the routes.
- The in-memory job maps are suitable only for one process. Persist job state or
  use a queue when requests can reach more than one process or must survive a
  restart.
- Keep generated packages in a dedicated directory. The recipes generate the
  directory server-side with a UUID and only expose it through a static HLS URL.
- A media player usually needs CORS when the API and player have different
  origins. Configure that at the application edge.
- SSE delivers one-way progress efficiently. Use a WebSocket gateway instead
  only if clients must send live control messages (such as cancellation).
- The NestJS recipe uses standard parameter decorators; retain
  `experimentalDecorators: true` in the host NestJS `tsconfig.json`.

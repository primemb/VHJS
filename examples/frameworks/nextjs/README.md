# Next.js App Router recipe

Copy `lib/vhjs-jobs.ts` and the `app/` folder into a Node-runtime Next.js App
Router application. The `public/hls/` directory is created at runtime and is
served by Next.js as `/hls/...`; add it to `.gitignore`.

```bash
pnpm add next react react-dom @primemb/vhjs
```

Start a job with `POST /api/transcodes` and connect an `EventSource` to
`/api/transcodes/<id>/events`. This recipe uses a process-local map, so deploy it
to a single long-lived Node process only; serverless or multi-instance deployments
need an external job queue/state store and durable object storage.

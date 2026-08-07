export default function CodePreview() {
  return (
    <section className="border-y border-ash-grey/30 bg-ghost-white py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-onyx md:text-4xl">
            Readable tests you actually understand
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-dim-grey">
            AI generates structured JSON. The dashboard renders it into
            human-readable steps.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          <div className="rounded-2xl border border-ash-grey/30 bg-onyx p-6">
            <p className="mb-3 text-xs font-medium text-dim-grey">
              Generated Test Plan
            </p>
            <pre className="font-mono text-xs leading-relaxed text-ash-grey">
              <code>{`{
  "name": "E2E Order Flow",
  "steps": [
    {
      "id": "login",
      "name": "User Login",
      "request": {
        "method": "POST",
        "url": "/auth/login",
        "body": {
          "email": "test@example.com",
          "password": "s3cret!"
        }
      },
      "extract": [
        { "name": "authToken",
          "path": "$.token" }
      ]
    },
    {
      "id": "create_order",
      "name": "Create Order",
      "dependsOn": ["login"],
      "request": {
        "method": "POST",
        "url": "/orders",
        "headers": {
          "Authorization": "Bearer {{authToken}}"
        }
      }
    }
  ]
}`}</code>
            </pre>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-ash-grey/30 bg-white p-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-onyx text-xs font-bold text-ghost-white">
                  1
                </span>
                <h4 className="font-bold text-onyx">User Login</h4>
              </div>
              <p className="mb-2 text-xs text-dim-grey">
                POST /auth/login
              </p>
              <div className="rounded-lg bg-ghost-white p-3 font-mono text-xs text-dim-grey">
                {`{ "email": "test@example.com", "password": "s3cret!" }`}
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="rounded bg-[#28c840]/10 px-1.5 py-0.5 font-medium text-[#28c840]">
                  200 OK
                </span>
                <span className="text-dim-grey">Token extracted</span>
              </div>
            </div>

            <div className="rounded-2xl border border-ash-grey/30 bg-white p-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-onyx text-xs font-bold text-ghost-white">
                  2
                </span>
                <h4 className="font-bold text-onyx">Create Order</h4>
              </div>
              <p className="mb-2 text-xs text-dim-grey">
                POST /orders · Uses{" "}
                <code className="rounded bg-ghost-white px-1 py-0.5">
                  authToken
                </code>
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="rounded bg-[#28c840]/10 px-1.5 py-0.5 font-medium text-[#28c840]">
                  201 Created
                </span>
                <span className="text-dim-grey">Order ID extracted</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

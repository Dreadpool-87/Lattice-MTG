const repository = "https://github.com/Dreadpool-87/Lattice-MTG";
const workflow = "https://api.github.com/repos/Dreadpool-87/Lattice-MTG/actions/workflows/pages.yml";
const startedHere = { pending: false, checkAfter: 0 };

function page(message, { status = 200, runId, canStart = false } = {}) {
  const nonce = crypto.randomUUID();
  const runLink = runId
    ? '<p><a href="' + repository + '/actions/runs/' + runId + '">View workflow run</a></p>'
    : '<p><a href="' + repository + '/actions/workflows/pages.yml">View workflow history</a></p>';
  const form = canStart
    ? '<form method="post" action="/refresh"><button>Update now</button></form>'
    : '<p><a href="/">Back to admin</a></p>';
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Lattice MTG Admin</title>' +
    '<style nonce="' + nonce + '">:root{color-scheme:light dark;font:1.1rem system-ui}' +
    'main{max-width:36rem;margin:12vh auto;padding:0 1rem}' +
    'button{font:inherit;padding:.75rem 1.25rem}</style>' +
    '<main><h1>Lattice MTG Admin</h1><p>' + message + '</p>' +
    form + runLink + '</main>' +
    '<script nonce="' + nonce + '">document.querySelector("form")?.addEventListener("submit", ' +
    'event => {const button=event.currentTarget.querySelector("button");' +
    'button.disabled=true;button.textContent="Starting…";});</script></html>',
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}

export default {
  async fetch(request, env, ctx) {
    const owner = env.ADMIN_EMAIL?.trim().toLowerCase();
    const identity = await ctx.access?.getIdentity();
    if (!owner || identity?.email?.toLowerCase() !== owner) {
      return new Response("Access denied.", { status: 403 });
    }
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      const run = url.searchParams.get("run");
      if (run && /^\d{1,20}$/.test(run)) {
        return page("GitHub accepted the update. Open the run to check the result.", { runId: run });
      }
      if (url.searchParams.get("submitted") === "1") {
        return page("GitHub accepted the update. Check the workflow history for the result.");
      }
      return page("Start a refresh of the Scryfall card data, sets, and rulings.", { canStart: true });
    }
    if (request.method !== "POST" || url.pathname !== "/refresh") {
      return new Response("Not found.", { status: 404 });
    }
    if (request.headers.get("Origin") !== url.origin) {
      return new Response("Access denied.", { status: 403 });
    }
    if (!env.GITHUB_ACTIONS_TOKEN) {
      return page("The GitHub credential has not been configured.", { status: 503 });
    }
    if (startedHere.pending || Date.now() < startedHere.checkAfter) {
      return page("An update request is being processed. Check the workflow history.", { status: 409 });
    }

    startedHere.pending = true;
    const headers = {
      Authorization: "Bearer " + env.GITHUB_ACTIONS_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "Lattice-MTG-Admin",
    };
    try {
      const history = await fetch(workflow + "/runs?branch=main&per_page=30", {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!history.ok) {
        return page("GitHub workflow status could not be checked. Check the workflow history.", { status: 502 });
      }
      const { workflow_runs: runs } = await history.json();
      const active = runs.find(run => run.event !== "pull_request" && run.status !== "completed");
      if (active) {
        const runId = Number.isSafeInteger(active.id) && active.id > 0 ? active.id : undefined;
        return page("A workflow is already queued or running.", { status: 409, runId });
      }

      startedHere.checkAfter = Date.now() + 30000;
      const response = await fetch(workflow + "/dispatches", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main", inputs: { refresh_data: true } }),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return page("GitHub did not confirm the update. Check the workflow history before trying again.", { status: 502 });
      }
      const result = response.status === 200 ? await response.json() : null;
      const id = result?.workflow_run_id;
      const query = Number.isSafeInteger(id) && id > 0 ? "run=" + id : "submitted=1";
      return new Response(null, {
        status: 303,
        headers: { Location: "/?" + query, "Cache-Control": "no-store" },
      });
    } catch {
      return page("GitHub could not be reached or the result is unknown. Check the workflow history before trying again.", { status: 502 });
    } finally {
      startedHere.pending = false;
    }
  },
};

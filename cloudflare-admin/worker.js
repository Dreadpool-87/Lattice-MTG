const repository = "https://github.com/Dreadpool-87/Lattice-MTG";
const workflow = "https://api.github.com/repos/Dreadpool-87/Lattice-MTG/actions/workflows/pages.yml";
const startedHere = { pending: false, checkAfter: 0 };

const workflowSources = {
  schedule: "Automatic",
  workflow_dispatch: "Manual",
};
const updateClock = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Brussels",
});

function githubHeaders(token) {
  return {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "Lattice-MTG-Admin",
  };
}

function runDetails(run, timestamp) {
  const time = Date.parse(timestamp);
  const label = Number.isFinite(time) ? updateClock.format(time) + " Belgian time" : "View run";
  return '<a href="' + repository + '/actions/runs/' + run.id + '">' +
    label + '</a> · ' + workflowSources[run.event];
}

function checkResult(run, published) {
  if (run.status !== "completed") {
    return run.status === "in_progress" ? "In progress" : "Queued";
  }
  if (run.conclusion === "cancelled") return "Cancelled";
  if (run.conclusion !== "success") return "Failed";
  return published ? "New data published" : "No changes";
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function failureDetails(run, jobs) {
  if (run.status !== "completed" || ["success", "cancelled"].includes(run.conclusion)) return "";
  const failed = jobs.find(job => ["failure", "timed_out", "action_required", "startup_failure"].includes(job.conclusion));
  if (!failed) return "";
  const step = failed.steps?.find(item => item.conclusion === "failure" || item.conclusion === "timed_out");
  const jobLabels = { refresh: "Data refresh", prepare: "Site build and verification", deploy: "GitHub Pages deployment" };
  const label = (jobLabels[failed.name] ?? failed.name) + (step?.name ? " / " + step.name : "");
  const jobLink = Number.isSafeInteger(failed.id) && failed.id > 0
    ? '<a href="' + repository + '/actions/runs/' + run.id + '/job/' + failed.id + '">' + escapeHtml(label) + '</a>'
    : escapeHtml(label);
  return " · " + jobLink;
}

async function updateHistory(token) {
  const unavailable = { lastCheck: "Unavailable", lastUpdate: "Unavailable" };
  if (!token) return unavailable;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const options = { headers: githubHeaders(token), redirect: "manual", signal: controller.signal };
  const get = async (url) => {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error("GitHub returned HTTP " + response.status);
    return response.json();
  };

  const recentChecks = [];
  let lastUpdate;
  try {
    const groups = await Promise.all(Object.keys(workflowSources).map(async (event) => {
      const data = await get(workflow + "/runs?branch=main&per_page=15&event=" + event);
      return data.workflow_runs;
    }));
    const runs = groups.flat().sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    const jobsBase = "https://api.github.com/repos/Dreadpool-87/Lattice-MTG/actions/runs/";
    for (const run of runs) {
      if (!Number.isSafeInteger(run.id) || run.id < 1 || !Object.hasOwn(workflowSources, run.event)) continue;
      const { jobs } = await get(jobsBase + run.id + "/jobs");
      const refresh = jobs.find(job => job.name === "refresh");
      if (refresh?.conclusion === "skipped") continue;
      if (!refresh && run.status === "completed" && run.event === "workflow_dispatch") continue;
      const published = refresh?.conclusion === "success" &&
        jobs.find(job => job.name === "deploy" && job.conclusion === "success");
      if (recentChecks.length < 5) {
        const time = run.status === "completed" ? run.updated_at : run.run_started_at ?? run.created_at;
        recentChecks.push(runDetails(run, time) + " · " + checkResult(run, published) + failureDetails(run, jobs));
      }
      if (published && !lastUpdate) lastUpdate = runDetails(run, published.completed_at);
      if (lastUpdate && recentChecks.length === 5) break;
    }
    return {
      lastCheck: recentChecks[0] ?? "No data check found in recent runs",
      recentChecks,
      lastUpdate: lastUpdate ?? "No data publication found in recent runs",
    };
  } catch {
    return {
      lastCheck: recentChecks[0] ?? "Temporarily unavailable",
      lastUpdate: lastUpdate ?? "Temporarily unavailable",
      recentChecks,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function page(message, { status = 200, runId, canStart = false, lastCheck, lastUpdate, recentChecks } = {}) {
  const nonce = crypto.randomUUID();
  const runLink = runId
    ? '<p><a href="' + repository + '/actions/runs/' + runId + '">View workflow run</a></p>'
    : '<p><a href="' + repository + '/actions/workflows/pages.yml">View workflow history</a></p>';
  const form = canStart
    ? '<form method="post" action="/refresh"><button>Update now</button></form>'
    : '<p><a href="/">Back to admin</a></p>';
  const history = recentChecks?.length
    ? '<details><summary>Recent data checks</summary><ol>' +
      recentChecks.map(check => '<li>' + check + '</li>').join('') + '</ol></details>'
    : '';
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Lattice MTG Admin</title>' +
    '<style nonce="' + nonce + '">:root{color-scheme:light dark;font:1.1rem system-ui}' +
    'main{max-width:36rem;margin:12vh auto;padding:0 1rem}' +
    'button{font:inherit;padding:.75rem 1.25rem}</style>' +
    '<main><h1>Lattice MTG Admin</h1><p>' + message + '</p>' +
    form + (lastCheck ? '<p>Last data check: ' + lastCheck + '</p>' : '') +
    (lastUpdate ? '<p>Last published update: ' + lastUpdate + '</p>' : '') + history + runLink + '</main>' +
    '<script nonce="' + nonce + '">document.querySelector("form")?.addEventListener("submit", ' +
    'event => {const button=event.currentTarget.querySelector("button");' +
    'button.disabled=true;button.textContent="Starting…";});</script></html>',
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'",
        "Referrer-Policy": "same-origin",
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
      return page("Start a refresh of the Scryfall card data, sets, and rulings.", {
        canStart: true,
        ...await updateHistory(env.GITHUB_ACTIONS_TOKEN?.trim()),
      });
    }
    if (request.method !== "POST" || url.pathname !== "/refresh") {
      return new Response("Not found.", { status: 404 });
    }
    if (request.headers.get("Origin") !== url.origin) {
      return new Response("Access denied.", { status: 403 });
    }
    const token = env.GITHUB_ACTIONS_TOKEN?.trim();
    if (!token) {
      return page("The GitHub credential has not been configured.", { status: 503 });
    }
    if (startedHere.pending || Date.now() < startedHere.checkAfter) {
      return page("An update request is being processed. Check the workflow history.", { status: 409 });
    }

    startedHere.pending = true;
    const headers = githubHeaders(token);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let stage = "workflow status check";
    try {
      const history = await fetch(workflow + "/runs?branch=main&per_page=30", {
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
      if (!history.ok) {
        console.warn("GitHub workflow status check HTTP status", history.status);
        return page("GitHub returned HTTP " + history.status + " while checking the workflow status.", { status: 502 });
      }
      const { workflow_runs: runs } = await history.json();
      const active = runs.find(run => run.event !== "pull_request" && run.status !== "completed");
      if (active) {
        const runId = Number.isSafeInteger(active.id) && active.id > 0 ? active.id : undefined;
        return page("A workflow is already queued or running.", { status: 409, runId });
      }

      stage = "update request";
      startedHere.checkAfter = Date.now() + 30000;
      const response = await fetch(workflow + "/dispatches", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main", inputs: { refresh_data: true } }),
        redirect: "manual",
        signal: controller.signal,
      });
      if (!response.ok) {
        console.warn("GitHub update request HTTP status", response.status);
        return page("GitHub returned HTTP " + response.status + " while starting the update. Check the workflow history before trying again.", { status: 502 });
      }
      const result = response.status === 200 ? await response.json().catch(() => null) : null;
      const id = result?.workflow_run_id;
      const query = Number.isSafeInteger(id) && id > 0 ? "run=" + id : "submitted=1";
      return new Response(null, {
        status: 303,
        headers: { Location: "/?" + query, "Cache-Control": "no-store" },
      });
    } catch (error) {
      const reason = controller.signal.aborted ? "timed out" :
        error instanceof SyntaxError ? "received an invalid response" : "could not complete the request";
      console.warn("GitHub " + stage, reason);
      return page("GitHub " + stage + ": " + reason + ". Check the workflow history before trying again.", { status: 502 });
    } finally {
      clearTimeout(timeout);
      startedHere.pending = false;
    }
  },
};

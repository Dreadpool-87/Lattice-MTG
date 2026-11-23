const controls = document.querySelector("#app-install");
const button = document.querySelector("#app-install-button");
const help = document.querySelector("#app-install-help");
let installPrompt;

if (navigator.standalone) controls.hidden = true;

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  button.hidden = false;
  help.hidden = true;
});

button.addEventListener("click", async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = undefined;
  button.disabled = true;
  try {
    const {outcome} = await prompt.prompt();
    if (outcome === "accepted") controls.hidden = true;
  } catch {
    // The browser menu remains available when the prompt cannot open.
    help.open = true;
  } finally {
    button.disabled = false;
    button.hidden = !installPrompt;
    help.hidden = Boolean(installPrompt);
  }
});

window.addEventListener("appinstalled", () => {
  installPrompt = undefined;
  controls.hidden = true;
});

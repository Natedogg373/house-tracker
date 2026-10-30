const form = document.querySelector("#add-form");
const input = document.querySelector("#house-input");
const submit = document.querySelector("#submit");
const result = document.querySelector("#result");

function showMessage(kind, text) {
  result.hidden = false;
  result.className = `banner ${kind}`;
  result.textContent = text;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (!value) {
    showMessage("error", "Enter a Zillow link or a street address.");
    input.focus();
    return;
  }

  submit.disabled = true;
  submit.textContent = "Sending…";
  result.hidden = true;

  try {
    const res = await fetch("/api/houses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage("error", data.error || "The request failed. Check the webhook configuration and try again.");
      return;
    }
    showMessage(
      "ok",
      data.message ||
        "Request sent. The house will appear on House Details in a few minutes."
    );
    form.reset();
  } catch {
    showMessage("error", "Could not reach the local server. Is it still running?");
  } finally {
    submit.disabled = false;
    submit.textContent = "Send to House Tracker";
  }
});

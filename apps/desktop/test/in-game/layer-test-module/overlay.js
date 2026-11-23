// The live view of the in-game layer test's panel: shows the count the panel passed to panel.setLive, as Tavora streams it.
const shown = document.querySelector('[data-testid="live-count"]');
const source = new EventSource("/_state");
source.onmessage = (event) => {
  const count = JSON.parse(event.data)?.state?.count;
  if (typeof count === "number") shown.textContent = String(count);
};

const NAV_MQ = window.matchMedia("(max-width: 839px)");

function setNavOpen(open) {
  const header = document.querySelector(".site-header");
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector("#site-nav");
  if (!header || !toggle || !nav) return;
  const isOpen = Boolean(open) && NAV_MQ.matches;
  header.classList.toggle("is-open", isOpen);
  document.body.classList.toggle("nav-open", isOpen);
  toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  toggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
}

function initNav() {
  const header = document.querySelector(".site-header");
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector("#site-nav");
  if (!header || !toggle || !nav) return;

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setNavOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) setNavOpen(false);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".site-header")) setNavOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setNavOpen(false);
  });

  const sync = () => setNavOpen(false);
  if (NAV_MQ.addEventListener) NAV_MQ.addEventListener("change", sync);
  else NAV_MQ.addListener(sync);

  setNavOpen(false);
}

initNav();

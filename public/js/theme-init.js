// Loaded as a classic script in <head> so a saved theme applies before first paint.
try {
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch {
  /* storage blocked: follow the system theme */
}

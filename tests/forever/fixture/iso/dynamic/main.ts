// Mirrors the chain of section 10.1 and the T10 seam: the entry imports the app dynamically, and only the app decides on
// the harness.
const out = document.querySelector('#out');
void import('./app').then((m) => m.bootApp(location.search)).then((state) => {
  if (out) out.textContent = state;
});

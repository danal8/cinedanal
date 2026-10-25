/* Installation UI is independent of search and profile/network initialization. */
(() => {
  const container = document.getElementById('installApp');
  const button = document.getElementById('installAppBtn');
  const help = document.getElementById('installHelp');
  const key = 'cinedanal_pwa_installed';
  const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']
    .map(mode => window.matchMedia(`(display-mode: ${mode})`));
  let deferredPrompt = null;
  let installed = false;
  let prompting = false;
  try { installed = localStorage.getItem(key) === '1'; } catch (_) { /* Storage is optional. */ }

  function standalone() {
    return navigator.standalone === true || modes.some(mode => mode.matches);
  }
  function closeHelp() {
    help.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }
  function render() {
    container.hidden = installed || standalone();
    button.disabled = prompting;
    if (container.hidden) closeHelp();
  }
  function markInstalled() {
    installed = true;
    deferredPrompt = null;
    try { localStorage.setItem(key, '1'); } catch (_) { /* Storage is optional. */ }
    render();
  }
  function syncDisplayMode() {
    if (standalone()) markInstalled();
    else render();
  }
  function showHelp() {
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) {
      help.textContent = 'Σε iPhone/iPad: άνοιξε τη σελίδα στο Safari, πάτησε Κοινοποίηση → Προσθήκη στην οθόνη Αφετηρίας → Προσθήκη. Αν εμφανίζεται, ενεργοποίησε «Άνοιγμα ως εφαρμογή ιστού».';
    } else if (/Android/.test(ua)) {
      help.textContent = 'Στο μενού του browser (⋮) επίλεξε «Εγκατάσταση εφαρμογής» ή «Προσθήκη στην αρχική οθόνη». Αν δεν υπάρχει επιλογή, άνοιξε τη σελίδα στο Chrome. Η διαθεσιμότητα εξαρτάται από τον browser.';
    } else if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) {
      help.textContent = 'Στο Safari σε υποστηριζόμενο macOS: Αρχείο → Προσθήκη στο Dock. Αν δεν υπάρχει αυτή η επιλογή, δοκίμασε Chrome ή Edge.';
    } else {
      help.textContent = 'Στο Chrome ή Edge χρησιμοποίησε το εικονίδιο εγκατάστασης στη γραμμή διεύθυνσης ή την επιλογή εγκατάστασης στο μενού του browser. Αν δεν εμφανίζεται ακόμη, δοκίμασε ξανά αφού περιηγηθείς στη σελίδα. Δεν υποστηρίζουν όλοι οι browsers εγκατάσταση.';
    }
    help.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    // A fresh offer also recovers from an uninstall since the previous visit.
    installed = false;
    try { localStorage.removeItem(key); } catch (_) { /* Storage is optional. */ }
    deferredPrompt = event;
    closeHelp();
    render();
  });
  window.addEventListener('appinstalled', markInstalled);
  modes.forEach(mode => {
    if (mode.addEventListener) mode.addEventListener('change', syncDisplayMode);
    else if (mode.addListener) mode.addListener(syncDisplayMode);
  });
  window.addEventListener('pageshow', syncDisplayMode);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      installed = event.newValue === '1';
      render();
    }
  });
  button.addEventListener('click', async () => {
    if (installed || standalone() || prompting) return;
    if (!deferredPrompt) {
      if (help.hidden) showHelp();
      else closeHelp();
      return;
    }
    const prompt = deferredPrompt;
    deferredPrompt = null; // Each browser event can only be used once.
    prompting = true;
    closeHelp();
    render();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') markInstalled();
    } catch (_) {
      if (!installed) showHelp();
    } finally {
      prompting = false;
      render();
    }
  });
  syncDisplayMode();
})();

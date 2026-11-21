/* Android back button: close the top-most layer first, and exit only from the home screen. */
(function () {
  function onBack() {
    if ($('cpick').classList.contains('on')) { closeColorPicker(); return; }
    if ($('modal').classList.contains('on')) { dismissModal(); return; }
    if (ANIM.open) {
      if ($('asSide') && $('asSide').classList.contains('open')) { $('asSide').classList.remove('open'); return; }
      closeAnimScreen();
      return;
    }
    if ($('side').classList.contains('open')) { togglePanel(); return; }
    if (!homeOn()) { showHome(); return; }
    const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (App && App.exitApp) App.exitApp();
  }
  function bind() {
    const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (App && App.addListener) App.addListener('backButton', onBack);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();

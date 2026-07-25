// Ранний перехват события установки. Chrome присылает beforeinstallprompt,
// как только считает сайт устанавливаемым, — на медленном телефоне это
// случается до того, как React смонтирует свой слушатель, и предложение
// установки терялось безвозвратно. Скрипт встраивается в разметку мобильного
// layout, срабатывает при разборе HTML и придерживает событие; компоненты
// (см. useInstallState в InstallPrompt.tsx) только читают отложенное.
//
// Отдельный модуль без "use client": строку встраивает серверный layout.

export const INSTALL_CAPTURE_SNIPPET = `(function(){
if(window.__sbInstallCapture)return;window.__sbInstallCapture=1;
addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__sbInstallEvent=e;dispatchEvent(new Event('sb:installable'))});
addEventListener('appinstalled',function(){window.__sbInstallEvent=null;dispatchEvent(new Event('sb:installed'))});
})();`;

// Прототипный JS: открытие/закрытие слоёв. В прод не идёт.

function openModal(id) {
  document.getElementById('ovl')?.classList.add('is-open');
  document.getElementById(id)?.classList.add('is-open');
}
function closeLayers() {
  document.getElementById('ovl')?.classList.remove('is-open');
  document.querySelectorAll('.modal.is-open, .sheet.is-open').forEach(el => el.classList.remove('is-open'));
}
function openSheet(id) {
  document.getElementById('ovl')?.classList.add('is-open');
  document.getElementById(id)?.classList.add('is-open');
}

// Поповеры: позиционируются рядом с кнопкой-триггером.
let popOpen = null;
function togglePop(id, btn) {
  const pop = document.getElementById(id);
  if (!pop) return;
  if (popOpen && popOpen !== pop) popOpen.classList.remove('is-open');
  const willOpen = !pop.classList.contains('is-open');
  if (willOpen && btn) {
    const r = btn.getBoundingClientRect();
    const pw = pop.offsetWidth || 200;
    let left = r.left + window.scrollX;
    if (left + pw > window.innerWidth - 12) left = r.right + window.scrollX - pw;
    pop.style.top = r.bottom + 6 + window.scrollY + 'px';
    pop.style.left = left + 'px';
  }
  pop.classList.toggle('is-open', willOpen);
  popOpen = willOpen ? pop : null;
}
document.addEventListener('click', (e) => {
  if (popOpen && !popOpen.contains(e.target) && !e.target.closest('[data-pop-trigger]')) {
    popOpen.classList.remove('is-open');
    popOpen = null;
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeLayers(); popOpen?.classList.remove('is-open'); popOpen = null; } });

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.querySelector('span').textContent = msg;
  t.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), 2200);
}
function toggleSwitch(el) { el.classList.toggle('is-on'); }

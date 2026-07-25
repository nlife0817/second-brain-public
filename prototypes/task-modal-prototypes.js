function updateSubtaskState(input) {
  const row = input.closest(".subtask");
  if (!row) return;
  row.classList.toggle("done", input.checked);
}

function initSubtasks() {
  document.querySelectorAll(".subtask input[type='checkbox']").forEach((input) => {
    updateSubtaskState(input);
    input.addEventListener("change", () => updateSubtaskState(input));
  });
}

function initTabs() {
  document.querySelectorAll("[data-tabs]").forEach((root) => {
    const tabs = root.querySelectorAll("[data-tab]");
    const panels = root.querySelectorAll("[data-panel]");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.getAttribute("data-tab");
        tabs.forEach((item) => item.classList.toggle("active", item === tab));
        panels.forEach((panel) => {
          panel.classList.toggle("active", panel.getAttribute("data-panel") === target);
        });
      });
    });
  });
}

function initTimer() {
  document.querySelectorAll("[data-timer]").forEach((root) => {
    const time = root.querySelector("time");
    const button = root.querySelector("button");
    let running = false;
    let seconds = Number(root.getAttribute("data-seconds") || 2520);

    function render() {
      const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
      const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
      const s = Math.floor(seconds % 60).toString().padStart(2, "0");
      time.textContent = `${h}:${m}:${s}`;
      button.textContent = running ? "Пауза" : "Старт";
    }

    setInterval(() => {
      if (!running) return;
      seconds += 1;
      render();
    }, 1000);

    button.addEventListener("click", () => {
      running = !running;
      render();
    });

    render();
  });
}

function initSelectFeedback() {
  document.querySelectorAll("select[data-chip-select]").forEach((select) => {
    select.addEventListener("change", () => {
      const chip = select.closest(".chip");
      if (!chip) return;
      chip.animate(
        [
          { transform: "scale(1)", backgroundColor: getComputedStyle(chip).backgroundColor },
          { transform: "scale(1.035)", backgroundColor: "#e9f2ff" },
          { transform: "scale(1)", backgroundColor: getComputedStyle(chip).backgroundColor },
        ],
        { duration: 220, easing: "ease-out" }
      );
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initSubtasks();
  initTabs();
  initTimer();
  initSelectFeedback();
});

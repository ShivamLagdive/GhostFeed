const DEFAULTS = {
  masterEnabled: true,
  hideHome: true,
  hideShorts: true,
  hideComments: true,
  hideSidebar: true,
  hideEndscreen: true,
  hideRecs: true,
  hideGuide: false,
  blurThumbs: false,
  playbackRate: 1
};

const ids = Object.keys(DEFAULTS).filter(id => id !== 'playbackRate'); // Exclude playbackRate

function getAll() {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULTS, (v) => resolve(v || DEFAULTS)));
}
function save(partial) {
  return new Promise((resolve) => chrome.storage.sync.set(partial, resolve));
}

function setControlsEnabled(enabled) {
  const controls = document.getElementById("controls");
  if (enabled) {
    controls.classList.remove("disabled");
  } else {
    controls.classList.add("disabled");
  }
}

(async function init() {
  const values = await getAll();
  
  // Handle checkboxes and other controls (excluding playbackRate)
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;

    if (typeof values[id] === 'boolean') {
      el.checked = !!values[id];
    }

    el.addEventListener('change', async () => {
      const val = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
      await save({ [id]: val });
      if (id === "masterEnabled") {
        setControlsEnabled(val);
      }
    });
  }

  // Initialize control lock
  setControlsEnabled(values.masterEnabled);
})();

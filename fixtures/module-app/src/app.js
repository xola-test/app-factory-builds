// A Mode B module app: it exports the lifecycle and nothing else. There is no
// index.html and no vite config here. CI generates the entrypoint and the SDK
// bootstrap (scripts/build-module-app.mjs) because the manifest declares
// moduleEntry.
import "./styles.css";

let cleanup = null;

export function mount(el, xola) {
    el.innerHTML = `
        <main class="app">
            <h1>Module app fixture</h1>
            <p class="muted">Mounted by the generated Xola bootstrap.</p>
            <button id="toast">Say hello</button>
        </main>
    `;

    const button = el.querySelector("#toast");
    const onClick = () => xola.ui.toast("success", "Hello from the module app fixture.");
    button.addEventListener("click", onClick);

    cleanup = () => button.removeEventListener("click", onClick);
}

export function unmount() {
    if (cleanup) {
        cleanup();
        cleanup = null;
    }
}

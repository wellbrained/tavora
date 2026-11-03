// Mounts the page of Tavora's own toasts (main/toast-view.ts): a see-through page above every panel that shows the toasts the
// host page hands over. It loads nothing of the host's state; the main process sends it what it needs.
import "./styles.css";
import { createApp } from "vue";
import ToastsPage from "./components/ToastsPage.vue";

document.documentElement.style.background = "transparent";
document.body.style.background = "transparent";
createApp(ToastsPage).mount("#app");

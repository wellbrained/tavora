import { createApp } from "vue";
import { installTitleTooltips } from "@tavora/official-ui/title-tooltips";
import App from "./App.vue";
import { setHintFloating } from "./host";
import "./styles.css";
import "./dock.css";

createApp(App).mount("#app");
// Every title hint in the page shows as the shared kit tooltip instead of the system's small one.
installTitleTooltips(document, { onOpenChange: setHintFloating });

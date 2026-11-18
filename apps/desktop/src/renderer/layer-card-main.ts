// Mounts the card at the top of the in-game layer (main/game-layer-card.ts): a see-through page of Tavora's own with the
// kit's segmented control and button. It loads nothing of the host's state; the main process sends it what it needs.
import "./styles.css";
import { createApp } from "vue";
import { installTitleTooltips } from "@tavora/official-ui/title-tooltips";
import LayerCard from "./components/LayerCard.vue";

document.documentElement.style.background = "transparent";
document.body.style.background = "transparent";
createApp(LayerCard).mount("#app");
// Every title hint shows as the kit's tooltip beside its control, as in the main window.
installTitleTooltips(document);

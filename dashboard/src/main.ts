import { createApp } from "vue";
import { registerOsxComponents } from "osx-components";
import "osx-components/theme.css";
import App from "./App.vue";
import "./style.css";

registerOsxComponents();
createApp(App).mount("#app");

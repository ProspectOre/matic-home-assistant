import { iconRobot } from "./robot-icon";

interface IconProvider {
  getIcon: (name: string) => Promise<{ path: string; viewBox: string }>;
  getIconList: () => Promise<{ name: string; keywords: string[] }[]>;
}

// Load globally, before the Map panel is opened, so the sidebar can render it.
// Preserve every other integration's icon namespace.
const host = window as Window & { customIcons?: Record<string, IconProvider> };
host.customIcons ??= {};
host.customIcons.matic = {
  getIcon: async (name) => ({
    path: name === "robot" ? iconRobot : "",
    viewBox: "0 0 24 24",
  }),
  getIconList: async () => [{ name: "robot", keywords: ["robot", "vacuum", "matic"] }],
};

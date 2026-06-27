import { createFileRoute } from "@tanstack/react-router";

import { ModelUsageSettingsPanel } from "../components/settings/ModelUsageSettings";

function SettingsModelUsageRoute() {
  return <ModelUsageSettingsPanel />;
}

export const Route = createFileRoute("/settings/model-usage")({
  component: SettingsModelUsageRoute,
});

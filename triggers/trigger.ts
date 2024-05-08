import { Trigger } from "deno-slack-sdk/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";

const trigger: Trigger = {
  type: TriggerTypes.Shortcut,
  name: "Tailscale Access",
  description: "Request temporary access to devices in your Tailnet",
  workflow: "#/workflows/create_access_request",
  inputs: {
    interactivity: {
      value: TriggerContextData.Shortcut.interactivity,
    },
    user: {
      value: TriggerContextData.Shortcut.user_id,
    },
  },
};

export default trigger;

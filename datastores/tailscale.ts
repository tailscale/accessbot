// /datastores/drafts.ts
import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

export const TailscaleTokenStore = DefineDatastore({
  name: "tailscale_access_token",
  primary_key: "client_id",
  time_to_live_attribute: "expires_at",
  attributes: {
    client_id: {
      type: Schema.types.string,
    },
    access_token: {
      type: Schema.types.string,
    },
    expires_at: {
      type: Schema.slack.types.timestamp,
    },
    refresh_token: {
      type: Schema.types.string,
    },
  },
});

export type AccessToken = typeof TailscaleTokenStore.definition;

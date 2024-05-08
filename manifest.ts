import { Manifest } from "deno-slack-sdk/mod.ts";
import { CreateAccessRequestWorkflow } from "./workflows/CreateAccessRequestWorkflow.ts";
import { AccessApprovalFunction } from "./functions/access_approval_prompt.ts";
import { AccessRequestFunction } from "./functions/access_request_prompt.ts";
import { TailscaleTokenStore } from "./datastores/tailscale.ts";
import {
  AccessType,
  ApproverType,
  DeviceType,
  ProfileType,
} from "./types/tailscale.ts";

export default Manifest({
  name: "Tailscale Access",
  description: "Ask for temporary access to devices in your Tailnet",
  icon: "./assets/avatar.png",
  workflows: [
    CreateAccessRequestWorkflow,
  ],
  datastores: [
    TailscaleTokenStore,
  ],
  functions: [
    AccessRequestFunction,
    AccessApprovalFunction,
  ],
  types: [
    ProfileType,
    DeviceType,
    ApproverType,
    AccessType,
  ],
  outgoingDomains: [
    "api.tailscale.com",
  ],
  botScopes: [
    "commands",
    "users:read", // look up user profile.
    "users:read.email", // look up user email address.
    "chat:write",
    "chat:write.public",
    "datastore:read",
    "datastore:write",
  ],
});

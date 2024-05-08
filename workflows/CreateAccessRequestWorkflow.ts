import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { AccessRequestFunction } from "../functions/access_request_prompt.ts";
import { AccessApprovalFunction } from "../functions/access_approval_prompt.ts";

export const CreateAccessRequestWorkflow = DefineWorkflow({
  callback_id: "create_access_request",
  title: "Request Tailscale Access",
  description: "Request temporary access to devices in your Tailnet",
  input_parameters: {
    properties: {
      interactivity: {
        type: Schema.slack.types.interactivity,
      },
      user: {
        type: Schema.slack.types.user_id,
      },
    },
    required: ["interactivity", "user"],
  },
});

const accessRequest = CreateAccessRequestWorkflow.addStep(
  AccessRequestFunction,
  {
    interactivity: CreateAccessRequestWorkflow.inputs.interactivity,
    user: CreateAccessRequestWorkflow.inputs.user,
  },
);

CreateAccessRequestWorkflow.addStep(AccessApprovalFunction, {
  interactivity: accessRequest.outputs.interactivity,
  access: accessRequest.outputs.access,
});

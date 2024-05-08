import { DefineType, Schema } from "deno-slack-sdk/mod.ts";
import { FunctionRuntimeParameters } from "deno-slack-sdk/functions/types.ts";

export const ProfileType = DefineType({
  name: "Profile",
  type: Schema.types.object,
  additionalProperties: false,
  required: ["attribute", "description"],
  properties: {
    attribute: {
      type: Schema.types.string,
    },
    description: {
      type: Schema.types.string,
    },
    maxSeconds: {
      type: Schema.types.number,
    },
    notifyChannel: {
      type: Schema.slack.types.channel_id,
    },
    approverEmails: {
      type: Schema.types.array,
      items: {
        type: Schema.types.string,
      },
    },
    canSelfApprove: {
      type: Schema.types.boolean,
      default: false,
    },
    confirmSelfApproval: {
      type: Schema.types.boolean,
      default: false,
    },
  },
});

export const DeviceType = DefineType({
  name: "Device",
  type: Schema.types.object,
  required: ["nodeId"],
  properties: {
    nodeId: {
      type: Schema.types.string,
    },
    name: {
      type: Schema.types.string,
    },
    addresses: {
      type: Schema.types.array,
      items: {
        type: Schema.types.string,
      },
    },
    tags: {
      type: Schema.types.array,
      items: {
        type: Schema.types.string,
      },
    },
    user: {
      type: Schema.types.string,
    },
    os: {
      type: Schema.types.string,
    },
  },
});

export const ApproverType = DefineType({
  name: "Approver",
  type: Schema.types.object,
  additionalProperties: false,
  required: [
    "userId",
  ],
  properties: {
    "userId": {
      type: Schema.slack.types.user_id,
    },
    "email": {
      type: Schema.types.string,
    },
  },
});

export type Access = FunctionRuntimeParameters<
  typeof AccessType.definition.properties,
  typeof AccessType.definition.required
>;

export const AccessType = DefineType({
  name: "Access",
  type: Schema.types.object,
  additionalProperties: false,
  required: [
    "profile",
    "requester",
    "device",
    "durationSeconds",
    "approver",
    "reason",
  ],
  properties: {
    requester: {
      type: Schema.slack.types.user_id,
    },
    profile: {
      type: ProfileType,
    },
    device: {
      type: DeviceType,
    },
    approver: {
      type: ApproverType,
    },
    durationSeconds: {
      type: Schema.types.number,
    },
    reason: {
      type: Schema.types.string,
    },
  },
});

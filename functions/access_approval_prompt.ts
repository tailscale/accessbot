import { SlackFunction } from "deno-slack-sdk/mod.ts";
import tailscale from "../tailscale.ts";
import { DefineFunction, Schema } from "deno-slack-sdk/mod.ts";
import { Access, AccessType } from "../types/tailscale.ts";
import { presetDurations } from "./access_request_prompt.ts";
import { Env, SlackAPIClient } from "deno-slack-sdk/types.ts";
import { BaseResponse } from "deno-slack-api/types.ts";

const APPROVE_ID = "approve_request";
const DENY_ID = "deny_request";

export const AccessApprovalFunction = DefineFunction({
  callback_id: "access_approval_prompt",
  title: "Access Request Approval",
  description: "Sends an access request to an approver for review",
  source_file: "functions/access_approval_prompt.ts",
  input_parameters: {
    properties: {
      interactivity: {
        type: Schema.slack.types.interactivity,
      },
      access: {
        // TODO(icio): By accepting all of the nested fields as arguments, we
        // allow callers to specify mismatched device name/nodeId/addresses to
        // mislead the approver. Workflow Builder also does not support complex
        // objects, so having a flat list of properties would enable users to
        // wire up their own approval flows.
        type: AccessType,
      },
    },
    required: [
      "interactivity",
      "access",
    ],
  },
  output_parameters: {
    properties: {},
    required: [],
  },
});

export default SlackFunction(
  AccessApprovalFunction,
  async ({ env, inputs, client }) => {
    const { profile, requester, approver } = inputs.access;

    if (approver.userId && requester === approver.userId && profile.confirmSelfApproval !== true) {
      await approve(env, client, true, inputs.access);
      return {
        completed: true,
        outputs: {},
      };
    }

    // Create a block of Block Kit elements composed of several header blocks
    // plus the interactive approve/deny buttons at the end
    const headerBlocks = accessRequestHeaderBlocks(inputs.access);
    const approverContext = approver.groupId
      ? [{
        type: "context",
        elements: [{ type: "mrkdwn", text: `Requested approver: <!subteam^${approver.groupId}>` }],
      }]
      : [];
    const blocks = headerBlocks
      .concat(approverContext)
      .concat([{
      "type": "actions",
      "block_id": "approve-deny-buttons",
      "elements": [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Approve",
          },
          action_id: APPROVE_ID,
          style: "primary",
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Deny",
          },
          action_id: DENY_ID,
          style: "danger",
        },
      ],
    }]);

    let targetChannel = approver.userId || "";
    if (!approver.userId && approver.groupId) {
      // For group approvers, we must post in a channel
      if (!profile.notifyChannel) {
        const msg = "A notifyChannel is required for group approvers.";
        console.log(msg);
        return { error: msg };
      }
      targetChannel = profile.notifyChannel;
    }

    const msgResponse = await client.chat.postMessage({
      channel: targetChannel,
      blocks,
      text: approver.groupId
        ? `<!subteam^${approver.groupId}> You have been asked to approve Tailscale access`
        : "You have been asked to approve Tailscale access",
    });

    if (!msgResponse.ok) {
      const msg = `Error sending message to approver: ${msgResponse.error}"`;
      console.log(msg);
      return { error: msg };
    }
    return {
      completed: false,
    };
  },
  // Create an 'actions handler', which is a function that will be invoked
  // when specific interactive Block Kit elements (like buttons!) are interacted
  // with.
).addBlockActionsHandler(
  // listen for interactions with components with the following action_ids
  [APPROVE_ID, DENY_ID],
  // interactions with the above two action_ids get handled by the function below
  async function ({ action, env, inputs, body, client }) {
    const approved = action.action_id == APPROVE_ID;
    const requester = inputs.access?.requester;
    const actorUserId = body.user?.id;
    const canSelfApprove = inputs.access?.profile?.canSelfApprove === true;

    // Guard: block self-approval when not permitted
    if (approved && actorUserId === requester && !canSelfApprove) {
      try {
        await client.chat.postEphemeral({
          channel: body.container.channel_id,
          user: actorUserId!,
          text: "You cannot approve your own access for this profile.",
        });
      } catch (_) {}
      return { error: "You cannot approve your own access for this profile." };
    }

    // Proceed with approval/denial
    await approve(env, client, approved, inputs.access, actorUserId);

    // Update the approver's message.
    const msgUpdate = await client.chat.update({
      channel: body.container.channel_id,
      ts: body.container.message_ts,
      blocks: accessRequestHeaderBlocks(inputs.access).concat([
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `${
                approved ? " :white_check_mark: Approved" : ":x: Denied"
              }`,
            },
          ],
        },
      ]),
    });
    if (!msgUpdate.ok) {
      const msg =
        `Error updating approver message requester: ${msgUpdate.error}"`;
      console.log(msg);
      return { error: msg };
    }

    await client.functions.completeSuccess({
      function_execution_id: body.function_data.execution_id,
      completed: true,
      outputs: {},
    });
  },
);

async function approve(
  env: Env,
  client: SlackAPIClient,
  approved: boolean,
  access: Access,
  actorUserId?: string,
) {
  const { profile, requester, durationSeconds, device, reason, approver } =
    access;

  const channels = [requester];
  if (profile.notifyChannel) {
    channels.push(profile.notifyChannel);
  }

  const requesterRes = client.users.info({ user: requester }).catch((
    err,
  ) => (console.error("Error loading requester user info:", err), undefined));
  const approverInfoUserId = actorUserId || approver.userId;
  const approverRes = approverInfoUserId
    ? client.users.info({ user: approverInfoUserId }).catch((
      err,
    ) => (console.error("Error loading approver user info:", err), undefined))
    : undefined;

  const msg = {
    blocks: [{
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            `<@${requester}>'s access request for ${profile.description} on <${
              tailscaleMachineLink(
                access.device.nodeId,
                access.device.addresses,
              )
            }|${access.device.name || access.device.nodeId}>` +
            `${reason ? ` for "${reason}"` : ""} was ${
              approved ? " :white_check_mark: Approved" : ":x: Denied"
            } by ${approverInfoUserId ? `<@${approverInfoUserId}>` : (approver.groupId ? `<!subteam^${approver.groupId}>` : "an approver")} until ` +
            new Date(Date.now() + durationSeconds * 1000).toISOString(),
        },
      ],
    }],
    text: `<@${requester}>'s access request was ${
      approved ? "approved" : "denied"
    }!`,
  };
  try {
    await Promise.all(
      channels.map((channel) =>
        client.chat.postMessage({ channel, ...msg }).then((r) => {
          if (r.ok) return r;
          throw new Error(`Error sending message to ${channel}: ${r.error}`);
        })
      ),
    );
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(errMsg);
    return { error: errMsg };
  }

  // Update Tailscale with the new attr request.
  if (approved) {
    const approverRefText = (await approverRes) ? userref(await approverRes) : (access.approver.groupId ? `group:${access.approver.groupId}` : "");
    let comment =
      `Tailscale Access Slackbot: request from ${
        userref(await requesterRes)
      } approved by ${approverRefText}` +
      (reason ? `\nReason: ${reason}` : "");
    if (comment.length > 200) {
      comment = comment.slice(0, 200);
    }
    const r = await tailscale(env, client)(
      `https://api.tailscale.com/api/v2/device/${
        encodeURIComponent(device.nodeId)
      }/attributes/${profile.attribute}`,
      {
        method: "POST",
        body: JSON.stringify({
          value: true,
          expiry: new Date(Date.now() + durationSeconds * 1000).toISOString(),
          comment: comment,
        }),
      },
    );
    console.info("tailscale attr update:", r.statusText, await r.text());
  }
}

function userref(res?: BaseResponse): string {
  if (res?.user?.name) {
    if (res?.user?.real_name) {
      return res.user.real_name + " (" + res.user.name + ")";
    }
    return res.user.name;
  }
  return "";
}

// deno-lint-ignore no-explicit-any
function accessRequestHeaderBlocks(access: any): any[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*:wave: <@${access.requester}> is requesting Tailscale access to ${access.profile.description}.*${
            access.reason ? "\n\nReason:\n>" + access.reason : ""
          }`,
      },
      fields: [
        {
          type: "mrkdwn",
          text: `:${osEmoji(access.device.os)}: <${
            tailscaleMachineLink(access.device.nodeId, access.device.addresses)
          }|${access.device.name || access.device.nodeId}>`,
        },
        {
          type: "mrkdwn",
          text: access.device.tags
            ? `:robot_face: \`${access.device.tags.join("\` \`")}\``
            : `:bust_in_silhouette: ${access.device.user}`,
        },
        {
          type: "mrkdwn",
          text: `:stopwatch: ${
            presetDurations.find((d) => d.seconds === access.durationSeconds)
              ?.text || (access.durationSeconds + " seconds")
          }`,
        },
        {
          type: "mrkdwn",
          text: `:label: \`${access.profile.attribute}\``,
        },
      ],
    },
  ];
}

function osEmoji(os?: string): string {
  switch (os) {
    case "android":
    case "iOS":
      return "iphone";
    case "tvOS":
      return "tv";
    default:
      return "computer";
  }
}

function tailscaleMachineLink(nodeId: string, addresses?: string[]): string {
  const m = "https://login.tailscale.com/admin/machines";
  if (addresses?.[0]) {
    return m + "/" + addresses[0];
  }
  return m + "?q=" + encodeURIComponent(nodeId);
}

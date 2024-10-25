import { SlackFunction } from "deno-slack-sdk/mod.ts";
import tailscale from "../tailscale.ts";
import { config } from "../config.ts";
import { SlackFunctionOutputs, SuggestionResponse } from "../types/slack.ts";
import { Env, SlackAPIClient } from "deno-slack-sdk/types.ts";
import { DefineFunction, Schema } from "deno-slack-sdk/mod.ts";
import { AccessType } from "../types/tailscale.ts";

export const AccessRequestFunction = DefineFunction({
  callback_id: "access_request_prompt",
  title: "Request Tailscale Access",
  source_file: "functions/access_request_prompt.ts",
  input_parameters: {
    properties: {
      interactivity: {
        type: Schema.slack.types.interactivity,
      },
      user: {
        type: Schema.slack.types.user_id,
      },
    },
    required: [
      "interactivity",
      "user",
    ],
  },
  output_parameters: {
    properties: {
      interactivity: {
        type: Schema.slack.types.interactivity,
      },
      access: {
        type: AccessType,
      },
    },
    required: [
      "interactivity",
      "access",
    ],
  },
});

const ACTION_PROFILE = "profile",
  ACTION_REASON = "reason",
  ACTION_DURATION = "duration",
  ACTION_APPROVER = "approver",
  ACTION_DEVICE = "device",
  SUBMIT_ID = "request_form";

export default SlackFunction(
  AccessRequestFunction,
  async ({ inputs, env, client }) => {
    // Open the empty modal.
    const r = await client.views.open({
      interactivity_pointer: inputs.interactivity.interactivity_pointer,
      view: await buildView(env, client, inputs.interactivity.interactor.id),
    });
    if (r.error || !r.ok) {
      console.error("Error opening view:", r);
      return {
        error: `opening view: ${r.error || "unknown error"}`,
      };
    }
    return { completed: false };
  },
)
  .addBlockActionsHandler(ACTION_PROFILE, async ({ client, env, body }) => {
    // Update the fields dependent on the selected profile.
    const r = await client.views.update({
      view_id: body.view.id,
      hash: body.view.hash,
      ...await buildView(env, client, body.user.id, body.view?.state),
    });
    if (r.error == "hash_collision") {
      return;
    }
    if (r.error || !r.ok) {
      return {
        error: `updating view: ${r.error || "unknown error"}`,
      };
    }
  })
  .addBlockSuggestionHandler(
    ACTION_DEVICE,
    async (
      { client, env, inputs, body },
    ): Promise<SuggestionResponse> => {
      // Start fetching the user profile.
      const requesterInfoRes = client.users.info({
        user: inputs.interactivity.interactor.id,
      }).catch((err) => ({
        ok: false,
        error: err,
        user: undefined,
      }));

      type Device = {
        nodeId: string;
        name: string;
        user: string;
        lastSeen: string;
        tags: string[];
        addresses: string[];
      };

      const query = body.value.trim().toLowerCase();

      let devices: Device[];
      try {
        // Fetch the list of devices.
        const ts = tailscale(env, client);
        const r = await ts(
          "https://api.tailscale.com/api/v2/tailnet/-/devices",
        );
        if (r.status !== 200) {
          throw new Error(r.statusText);
        }

        // Filterthe devices by the query.
        devices = (await r.json()).devices as Device[];
        if (devices?.length && query) {
          devices = devices.filter(
            (d: Device) =>
              d.name.includes(query) || d.nodeId.startsWith(query) ||
              d.addresses?.some((ip) => ip.startsWith(query)),
          );
        }
      } catch (e) {
        console.error("Error loading devices", e);
        return {
          options: [{
            value: "!",
            text: {
              type: "plain_text",
              emoji: true,
              text: `:warning: Error retreiving devices: ${e.message}`,
            },
          }],
        };
      }

      if (!devices || !devices.length) {
        return { options: [] };
      }

      // List the user's top devices.
      let yourDevices: Device[] = [];
      try {
        // Wait for the email.
        const requesterInfo = await requesterInfoRes;
        if (!requesterInfo.ok) {
          throw new Error(
            `looking up requester info: ${requesterInfo.error}"`,
          );
        }
        const email = requesterInfo?.user?.profile?.email?.toLowerCase();
        if (!email) {
          throw new Error(`no email in: ${requesterInfo}"`);
        }

        // Filter the devices, sorted by most recently active.
        yourDevices = devices.filter((d) =>
          d.user.toLowerCase() == email && !d.tags
        );
        yourDevices.sort((a, b) => a.lastSeen < b.lastSeen ? 1 : -1);
      } catch (err) {
        // Carry on with the rest of our devices, even if we didn't get an email
        // to provide a pre-filtered list.
        console.error("Error loading user email to filter devices:", err);
      }

      return {
        option_groups: [
          {
            label: {
              type: "plain_text",
              text: "Your Devices",
            },
            options: yourDevices.slice(0, 80).map((d) => ({
              value: d.nodeId,
              text: {
                type: "plain_text",
                text: d.name,
              },
            })),
          },
          {
            label: {
              type: "plain_text",
              text: "All Devices",
            },
            options: devices.slice(0, 20).map((d) => ({
              value: d.nodeId,
              text: {
                type: "plain_text",
                text: d.name,
              },
            })),
          },
        ].filter((g) => g.options?.length > 0),
      } as SuggestionResponse;
    },
  )
  .addViewSubmissionHandler(
    SUBMIT_ID,
    async ({ body, env, client, inputs }) => {
      const errors: Record<string, string> = {};
      const s = formState(body.view.state);

      // Validate the profile.
      const profile = config.profiles.find((p) => p.attribute === s.profile);
      if (!profile) {
        errors[ACTION_PROFILE] =
          `Access with attribute ${s.profile} could not be found.`;
      }
      if (!s.profile) {
        errors[ACTION_PROFILE] = "Choose which access to request.";
      }

      // Validate the device.
      if (!s.device || s.device === "!") {
        errors[ACTION_DEVICE] = "Choose which device to use.";
      }

      // Validate the approver.
      let [approverId, approverEmail] = (s.approver || "").split(":", 2);
      if (!approverId) {
        errors[ACTION_APPROVER] = "An approver is required to confirm access.";
      } else if (profile) {
        if (!profile.canSelfApprove && approverId === inputs.user) {
          errors[ACTION_APPROVER] ||= `You cannot approve your own access to ${
            profile?.description || "this profile"
          }.`;
        }
        // If the user was presented with a user_select to choose the approver,
        // then we didn't pass through the email address in the value, so load it.
        if (!approverEmail) {
          try {
            const r = await client.users.info({ user: approverId });
            approverEmail = r.user?.profile?.email || "";
            if (r.error) {
              errors[ACTION_APPROVER] ||= "Error loading approver email: " +
                r.error;
            }
          } catch (e) {
            errors[ACTION_APPROVER] ||= "Error loading approver email: " + e;
          }
        }
        // Validate the approver is allowed by the profile configuration.
        approverEmail = approverEmail.trim().toLowerCase();
        console.log({
          approverId,
          approverEmail,
          allowed: profile.approverEmails,
        });
        if (
          profile.approverEmails?.length &&
          !profile.approverEmails.some((e) =>
            e.trim().toLowerCase() == approverEmail
          )
        ) {
          errors[ACTION_APPROVER] ||=
            `The user you selected cannot approve access to ${profile.description}.`;
        }
      }

      // Return any validation errors that we've found.
      for (const _ in errors) {
        return {
          response_action: "errors",
          errors,
        };
      }

      // Load the details of the device that we selected.
      let device;
      try {
        device = await tailscale(env, client)(
          `https://api.tailscale.com/api/v2/device/${
            encodeURIComponent(s.device!)
          }`,
        )
          .then((r) => r.json());
      } catch (e) {
        console.trace(`error fetching tailscale device: ${e}`);
      }

      const outputs: SlackFunctionOutputs<
        typeof AccessRequestFunction.definition
      > = {
        interactivity: body.interactivity,
        access: {
          requester: inputs.user,
          profile: profile!,
          approver: {
            userId: approverId,
            email: approverEmail,
          },
          device: {
            nodeId: s.device!,
            name: device?.name || undefined,
            tags: device?.tags || undefined,
            user: device?.user || undefined,
            addresses: device?.addresses || undefined,
            os: device?.os || undefined,
          },
          reason: s.reason!,
          durationSeconds: parseInt(s.duration!, 10),
        },
      };
      console.log("done", body.view.state, s, outputs);

      // Pass the request data onto the next workflow step.
      await client.functions.completeSuccess({
        function_execution_id: body.function_data.execution_id,
        outputs,
      });
    },
  );

type FormState = {
  [ACTION_PROFILE]?: string;
  [ACTION_DEVICE]?: string;
  [ACTION_DURATION]?: string;
  [ACTION_APPROVER]?: string;
  [ACTION_REASON]?: string;
};

// deno-lint-ignore no-explicit-any
function formState(state: any): FormState {
  const s: FormState = {};
  for (const blockId in state.values) {
    const block = state.values[blockId];
    for (const actionId in block) {
      // Filter out bad fields so that s[actionId] is known to be a valid field.
      if (
        actionId !== ACTION_APPROVER && actionId !== ACTION_DEVICE &&
        actionId !== ACTION_DURATION && actionId !== ACTION_PROFILE &&
        actionId !== ACTION_REASON
      ) {
        continue;
      }

      // Set the field from the inputs.
      const act = block[actionId];
      if (act["selected_option"]) {
        s[actionId] = act.selected_option.value;
      }
      if (act["selected_user"]) {
        s[actionId] = act.selected_user;
      }
      if (act["selected_users"]) {
        s[actionId] = act.selected_users;
      }
      if ("value" in act) {
        s[actionId] = act.value;
      }
    }
  }
  return s;
}

const minuteSecs = 60;
const hourSecs = 60 * minuteSecs;
const daySecs = 24 * hourSecs;

export const presetDurations = [
  { text: "5 minutes", seconds: 5 * minuteSecs },
  { text: "30 minutes", seconds: 30 * minuteSecs },
  { text: "1 hour", seconds: 1 * hourSecs },
  { text: "4 hours", seconds: 4 * hourSecs },
  { text: "8 hours", seconds: 8 * hourSecs },
  { text: "12 hours", seconds: 12 * hourSecs },
  { text: "24 hours", seconds: 1 * daySecs },
  { text: "2 days", seconds: 2 * daySecs },
  { text: "3 days", seconds: 3 * daySecs },
  { text: "4 days", seconds: 4 * daySecs },
  { text: "5 days", seconds: 5 * daySecs },
  { text: "6 days", seconds: 6 * daySecs },
  { text: "7 days", seconds: 7 * daySecs },
];

async function buildView(
  env: Env,
  client: SlackAPIClient,
  userId?: string,
  // deno-lint-ignore no-explicit-any
  viewState: any = {},
) {
  if (!env.TAILSCALE_CLIENT_ID || !env.TAILSCALE_CLIENT_SECRET) {
    return buildEnvvarView();
  }

  const state = formState(viewState);
  const profile = config.profiles.find((p) => p.attribute === state.profile);
  const profileOpts = config.profiles.map((p) => ({
    value: p.attribute,
    text: {
      type: "plain_text",
      text: p.description,
    },
  }));

  const maxSeconds = profile?.maxSeconds || daySecs;
  const durationOpts = presetDurations
    .filter((d) => d.seconds <= maxSeconds)
    .map((d) => ({
      text: { type: "plain_text", text: d.text },
      value: d.seconds.toFixed(0),
    }));
  state.duration ||= durationOpts[0].value;

  return {
    type: "modal",
    callback_id: SUBMIT_ID,
    title: {
      type: "plain_text",
      text: "Requesting Access",
    },

    submit: {
      type: "plain_text",
      text: "Submit",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    clear_on_close: true, // Do we want or not want this?
    notify_on_close: false, // Should we mark the function as completed/errored when the window is closed? If so, how do we complete the workflow?
    // submit_disabled: true, // Errors: Apparently only for "configuration modals" - "Configuration modals are used in Workflow Builder during the addition of Steps from Apps" but "We're retiring all Slack app functionality around Steps from Apps in September 2024."
    blocks: [
      {
        block_id: "profile",
        type: "input",
        dispatch_action: true,
        label: {
          type: "plain_text",
          emoji: true,
          text: `:closed_lock_with_key: What do you want to access?`,
        },
        element: {
          action_id: ACTION_PROFILE,
          type: "static_select",
          placeholder: {
            type: "plain_text",
            text: "Choose access...",
          },
          options: profileOpts,
          initial_option: state.profile
            ? profileOpts.find((p) => p.value === state.profile)
            : undefined,
        },
      },
      {
        block_id: "device",
        type: "input",
        label: {
          type: "plain_text",
          emoji: true,
          text: `:computer: Which device are you using?`,
        },
        element: {
          action_id: ACTION_DEVICE,
          type: "external_select",
          placeholder: {
            type: "plain_text",
            text: "Choose device...",
          },
          min_query_length: 0,
        },
      },
      state.profile && {
        block_id: "duration",
        type: "input",
        label: {
          type: "plain_text",
          emoji: true,
          text: ":stopwatch: For how long?",
        },
        element: {
          action_id: ACTION_DURATION,
          type: "static_select",
          placeholder: {
            type: "plain_text",
            text: "Choose duration...",
          },
          options: durationOpts,
          initial_option: durationOpts.find((d) => d.value === state.duration),
        },
      },
      state.profile && await buildApproverBlock(
        client,
        userId,
        profile?.canSelfApprove,
        profile?.approverEmails,
      ),
      state.profile && {
        block_id: "reason",
        type: "input",
        label: {
          type: "plain_text",
          emoji: true,
          text: ":open_book: What do you need the access for?",
        },
        element: {
          action_id: ACTION_REASON,
          type: "plain_text_input",
          // 80 is arbitrary here. If the final comment (that also includes
          // requester and approver names) comes over the API limit of 200
          // characters, we'll truncate it before sending the request.
          max_length: 80,
          placeholder: {
            type: "plain_text",
            text: "Enter reason...",
          },
        },
      },
    ].filter(Boolean),
  };
}

async function buildApproverBlock(
  client: SlackAPIClient,
  userId?: string,
  canSelfApprove?: boolean,
  emails?: string[],
) {
  if (!emails?.length && canSelfApprove) {
    return {
      block_id: "approver",
      type: "input",
      label: {
        type: "plain_text",
        emoji: true,
        text: ":sleuth_or_spy: Who should approve?",
      },
      element: {
        action_id: ACTION_APPROVER,
        type: "radio_buttons",
        initial_option: {
          value: userId,
          text: {
            type: "plain_text",
            text: "No approval neeeded",
          },
        },
        options: [
          {
            value: userId,
            text: {
              type: "plain_text",
              text: "No approval neeeded",
            },
          },
        ],
      },
    };
  }

  if (!emails?.length || emails.length > 10) {
    // We can't use radio buttons for this.
    return {
      block_id: "approver",
      type: "input",
      label: {
        type: "plain_text",
        emoji: true,
        text: ":sleuth_or_spy: Who should approve?",
      },
      element: {
        action_id: ACTION_APPROVER,
        type: "users_select",
        placeholder: {
          type: "plain_text",
          emoji: true,
          text: "Choose an approver...",
        },
      },
    };
  }

  // We can't use the users_select with a specific set of users, but we can show
  // up to 10 radio buttons.
  const users = await Promise.all(
    emails.map((email) => client.users.lookupByEmail({ email })),
  );

  // Filter the list of approvers to successful responses.
  const approvers = users.filter((u) =>
    u.ok && u.user && !u.user.deleted &&
    (canSelfApprove || emails.length == 1 || u.user.id != userId)
  );

  // Warn about any users who could not be found by email.
  const failedLooksup = users.map((u, i) =>
    u.ok && u.user && !u.user.deleted ? null : emails[i]
  ).filter(
    Boolean,
  );

  return {
    block_id: "approver",
    type: "input",
    label: {
      type: "plain_text",
      emoji: true,
      text: ":sleuth_or_spy: Who should approve?",
    },
    hint: failedLooksup?.length
      ? {
        type: "plain_text",
        text: `Lookups failed for: ${failedLooksup.join(", ")}`,
      }
      : undefined,
    element: {
      action_id: ACTION_APPROVER,
      type: "radio_buttons",
      options: approvers.length
        ? approvers.map((u) => ({
          value: u.user.id + ":" + (u.user.profile?.email || ""),
          text: {
            type: "mrkdwn",
            text: `<@${u.user.id}> - ${u?.user?.profile?.real_name}${
              userId == u.user.id ? " (You)" : ""
            }`,
          },
          description: {
            type: "plain_text",
            text: "Local time: " + localTime(u.user.tz_offset),
          },
        }))
        : [{
          // FIXME: What happens when we try to let the user do this?
          value: "!",
          text: {
            type: "plain_text",
            emoji: true,
            text: ":warning: No reviewers could be found.",
          },
        }],
    },
  };
}

/**
 * @param offsetSeconds The seconds east of UTC (Slack's user.tz_offset).
 * @returns
 */
function localTime(offsetSeconds: number): string {
  const now = new Date();
  now.setUTCSeconds(offsetSeconds + now.getTimezoneOffset() * 60);
  return now.toLocaleTimeString(undefined, {
    timeStyle: "short",
    hourCycle: "h12",
  });
}

function buildEnvvarView() {
  return {
    type: "modal",
    title: {
      type: "plain_text",
      text: "Requesting Access",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    clear_on_close: true,
    notify_on_close: false,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: ":warning: This workflow requires configuring the " +
            "`TAILSCALE_CLIENT_ID` and `TAILSCALE_CLIENT_SECRET` " +
            "environment variables. Without it, API requests to " +
            "Tailscale would fail.",
        },
      },
    ],
  };
}

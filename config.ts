export const config: Config = {
  profiles: [
    {
      description: "Accessbot Test",
      attribute: "custom:accessbotTester",
      canSelfApprove: true,
      confirmSelfApproval: true,
    },
    {
      attribute: "custom:prodAccess",
      description: "Production",
      notifyChannel: "C06TH49GKHC",
      canSelfApprove: true,
      approverEmails: [
        "paul@tailscale.com",
        "anton@tailscale.com",
        "kristoffer@tailscale.com",
        "apenwarr@tailscale.com",
        "bradfitz@tailscale.com",
        "unknown@tailscale.com",
      ],
    },
    {
      attribute: "custom:stagingAccess",
      description: "Staging",
      notifyChannel: "C06TH49GKHC",
      canSelfApprove: true,
    },
    {
      attribute: "custom:bust",
      description: "Only unrecognised reviewers",
      notifyChannel: "C06TH49GKHC",
      canSelfApprove: false,
      approverEmails: [
        "unknown@tailscale.com",
        "nobody@tailscale.com",
        "dgentry@tailscale.com", // :(
      ],
    },
  ],
};

export type Config = {
  /**
   * Profiles must be a non-empty set of configuration.
   */
  profiles: [Profile, ...Profile[]];
};

export type Profile = {
  /**
   * The human-readable name for the profile being granted access to by the attribute.
   * @example "Production"
   */
  description: string;
  /**
   * The tailscale attribute added to a device for the selected duration, upon
   * the request being approved.
   */
  attribute: string;

  /**
   * The maximum duration to offer the user when they are requesting access to
   * this profile.
   * @default undefined (meaning offer all preset durations to the user)
   */
  maxSeconds?: number;
  /**
   * The channel identifier to post approve/deny updates to.
   * @example "CQ12VV345"
   * @default undefined (meaning no public channel updates)
   */
  notifyChannel?: string;

  /**
   * Email addresses of people who may approve an access request. These are
   * looked-up to find the relevant slack users.
   * @default undefined (meaning anybody can approve)
   */
  approverEmails?: string[];

  /**
   * Whether a user can mark themselves as the approver for a request.
   * @default false
   */
  canSelfApprove?: boolean;

  /**
   * Whether a user self-approving is prompted to approve their own access
   * request. Can be set to true to show them the prompt anyway.
   * @default false (skip self-approval)
   */
  confirmSelfApproval?: boolean;
};

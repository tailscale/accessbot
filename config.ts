export const config: Config = {
  profiles: [
    {
      // You can use this example config to test approvals with your own user.
      //
      // If you enter your own user as the approver, you will still be asked to
      // to approve it, which is not the default behaviour.
      description: "Accessbot Test: Review",
      attribute: "custom:accessbotTestReview",
      canSelfApprove: true,
      confirmSelfApproval: true,
    },
    {
      attribute: "custom:accessbotTest",
      description: "Accessbot Test: Select Users",
      canSelfApprove: true,
      maxSeconds: 3 * 86400, // 3 days.
      approverEmails: [
        // Enter some email addresses here.
        "someone@example.com",
      ],
      // You can send announcements of approvals to a Slack channel.
      // Navigate to the channel in Slack, then click the channel name above the
      // chat and in the window that opens, select the About tab. The channel ID
      // is available at the bottom of this window.
      // notifyChannel: "C06TH49GKHC",
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
   * @default 86400 (1 day, can be increased to 7*86400 for 7 days)
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

# Tailscale Slack Accessbot

This is an example Slack Workflow App that allows users to use Slack to request
instantaneous, time-bound access, known as just-in-time access, to Tailscale
resources from other people in their organization.

<img src="images/tailscale-access-requesting-access.png" alt="Tailscale Access request access form in Slack" width="400"/>

Note that it relies on Tailscale
[custom device posture attributes](https://tailscale.com/api#tag/devices/POST/device/{deviceId}/attributes/{attributeKey})
API that might not be available on all pricing plans.

## Deploy the Slack App for the first time

1. Confirm that the Slack Team to which you want to install the Tailscale
   Accessbot has a paid [Slack plan](https://app.slack.com/plans/) which allows
   you to **Deploy apps to Slack infrastructure**.

1. Install [Deno](https://www.deno.com/) on your local machine following the
   Deno
   [Installation instructions](https://docs.deno.com/runtime/manual/getting_started/installation).

1. Install the Slack CLI on your local machine following the Slack
   [Quickstart Guide](https://api.slack.com/automation/quickstart) (or just
   `brew install slack-cli` on macOS).

1. Authenticate with the Slack CLI by running `slack login` in your terminal:

   1. The output will contain a command like
      `/slackauthticket NzY5YmViN2QtY2ZjZS12ZmRjLTlmYTktNjI0NjI5NWI1ODFk` which
      you should paste into the Slack chat box.
   1. Approve the permissions that Slack will grant your CLI.
   1. Paste the confirmation code back into the Slack CLI's **Enter challenge
      code** prompt.

1. Add the Tailscale Accessbot code to a git repository of your own:

   1. Run the following commands to create a new directory for the accessbot
      code and config:
      ```shell
      mkdir tailscale-accessbot
      cd tailscale-accessbot
      ```

   1. Run the following commands to pull the Tailscale Accessbot code into your
      new directory:
      ```shell
      git init -b main
      git remote add upstream https://github.com/tailscale/accessbot.git
      git pull upstream main
      ```

   1. (Optional, recommended) Create a private git repository on GitHub, GitLab,
      or your preferred git host of choice, and push your code there:
      ```shell
      git remote add origin git@github.com:myorg/tailscale-accessbot
      git push -u origin main
      ```

1. Deploy the app to Slack:

   1. Run the following command to begin deploying your app to Slack, which will
      prompt you to select the Team to install to:
      ```shell
      slack deploy
      ```
      - If you receive an error containing `app_approval_request_denied` then
        your Slack team is configured with **Require App Approval** turned on
        but **Allow members to request approval for apps** turned off. Speak to
        one of your Slack team owners about changing these settings to allow you
        to proceed. They can either turn on the **Allow members to request
        approval for apps** setting or add your user to the **Select App
        Managers to manage apps** > **Workspace Owners and selected members or
        groups** option. Retry `slack deploy` after this change.
      - If you are asked whether you would like to request approval to install
        the app, select **Yes**. Once Slack tells you that approval has been
        granted, you may re-run `slack deploy`.

   1. Create the trigger when prompted.

   1. Slack will give you a Shortcut URL such as
      `https://slack.com/shortcuts/Ft074AB2RW12/…` which won't work in your web
      browser, but which can be used within the Slack app. Paste the Shortcut
      URL from your terminal into a Slack chatroom and it will render a **Start
      Workflow** button:

      <img src="images/tailscale-access-shortcut.png" alt="'Start Workflow' link rendered in Slack" width="400"/>

   1. Selecting the **Start Workflow** button will show the following error
      because we are yet to connect it to Tailscale:

      <img src="images/tailscale-access-unconfigured.png" alt="Tailscale workflow before configuration" width="400"/>

   1. The Slack CLI will have created a `.slack` directory containing
      `apps.json` and `config.json` files. These contain the app identifiers
      that allow the Slack CLI to update the app later. You should now
      `git commit` these files and if backing up to a remote repository,
      `git push`.

1. Connect the app to Tailscale:

   1. [Generate an OAuth client](https://login.tailscale.com/admin/settings/oauth)
      in Tailscale with the `devices:core:read` and `devices:posture_attributes`
      scopes:

      <img src="images/tailscale-oauth-client.png" alt="Tailscale accessbot OAuth Client" width="400"/>

   1. Run the following command from your accessbot directory, using the OAuth
      Client ID in place of `<client-id>`, and selecting the appropriate team
      when prompted:
      ```shell
      slack env add TAILSCALE_CLIENT_ID <client-id>
      ```

   1. Run the following command from your accessbot directory, using the OAuth
      Client secret in place of `<secret>`, and selecting the appropriate team
      when prompted:
      ```shell
      slack env add TAILSCALE_CLIENT_SECRET <secret>
      ```

   1. Going back to Slack, selecting the **Start Workflow** button again should
      now present the Accessbot screen:

      <img src="images/tailscale-access-init.png" alt="Tailscale Access starting request form in Slack" width="400"/>

      - An alternative way to trigger the workflow is to start typing its name
        in the "slash command" pop-up menu that you should see after pressing
        the "/" key.

   1. Any errors that occur during the operation of the Workflow will be sent to
      you in Slack, or can be inspected on demand using `slack activity`, or
      watched in real-time using `slack activity --tail`.

   1. Proceed to the next section to configure the available access profiles and
      update your app.

## Configure profiles

Configuration of Tailscale Access profiles is done by editing `config.ts`. All
available configuration options can be seen in the schema under `config.ts`.

An example of a minimal configuration can begin as follows:

```typescript
export const config: Config = {
  profiles: [
    {
      attribute: "custom:prodAccess",
      description: "Production",
      notifyChannel: "C06TH49GKHC",
      canSelfApprove: true,
      approverEmails: [
        "alice@example.com",
        "bob@example.com",
        "charlie@example.com",
      ],
    },
  ],
} as Config;
```

See the `type Profile` declaration at the bottom of config.ts for a description
of the different fields available in this config.

After changing config.ts, you must run another `slack deploy` to see the config
update in the app. It is recommended that you `git commit` and `git push` at
this point too.

[Slack documentation](https://api.slack.com/automation/cli/CI-CD-tutorial) has
instructions on automatic deployment of the workflow using Github Actions.

## Use the attributes as part of network policy

After the workflow has been configured and deployed, you can start using
attributes corresponding to the configured access profiles as part of your
network policy.

For example, the `custom:prodAccess` attribute managed by the workflow can be
referenced by a posture and required for production access:

```
"postures": {
    "posture:prodAccess": ["custom:prodAccess == true"],
},
"acls": [
    {
        "action": "accept",
        "src": ["group:dev"],
        "dst": ["tag:production"],
        "srcPosture": ["posture:prodAccess"]
    },
],
```

See the [Device Posture](https://tailscale.com/kb/1288/device-posture) topic and
the [tailnet policy file syntax](https://tailscale.com/kb/1337/acl-syntax/#acls)
topic for more information about postures and posture conditions.

## Develop with the accessbot locally

You can run the workflow locally, before deploying it to Slack's infrastructure.

First add the Tailscale Client ID and Secret from the previous step to a `.env`
file in the root of the project:

```.env
TAILSCALE_CLIENT_ID=abc1234CNTRL
TAILSCALE_CLIENT_SECRET=tskey-client-abc1234CNTRL-qwerty1234...
```

Then you can run the application using the `slack` CLI. You'll know an app is
the development version if the name has the string `(local)` appended:

```shell
# Run app locally
slack run

Connected, awaiting events
```

To stop running locally, press `<CTRL> + C` to end the process.

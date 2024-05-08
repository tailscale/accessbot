import { Env, SlackAPIClient } from "deno-slack-sdk/types.ts";
import { AccessToken, TailscaleTokenStore } from "./datastores/tailscale.ts";
import { OAuth2, OAuth2Token } from "npm:fetch-mw-oauth2@1";

const ua = "tailscale-accessbot/0.0.1";

export type TailscaleRequestInit = RequestInit & {
  cacheSeconds?: number;
};

/**
 * @param env The slack environment containing TAILSCALE_CLIENT_ID and TAILSCALE_CLIENT_SECRET.
 * @param client SlackAPIClient for accessing the Datastore where we persist temporary access tokens for re-use between bot interactions.
 * @returns
 */
export default function tailscale(
  env: Env,
  client: SlackAPIClient,
) {
  const clientId = env.TAILSCALE_CLIENT_ID;
  const clientSecret = env.TAILSCALE_CLIENT_SECRET;

  // Try to read an existing access token from the data store.
  const ts = client.apps.datastore.get<AccessToken>({
    datastore: TailscaleTokenStore.name,
    id: clientId,
  })
    .catch((err) => {
      // If an error occurs, continue anyway.
      console.error("Exception reading token from datastore:", err);
      return null;
    })
    .then((tokRes) => {
      // Try to retrieve a token, but not too hard.
      const tok = tokRes && tokRes.ok && tokRes.item.access_token
        ? {
          accessToken: tokRes.item.access_token,
          refreshToken: tokRes.item.refresh_token,
          expiresAt: tokRes.item.expires_at
            ? tokRes.item.expires_at * 1000
            : undefined,
        } as OAuth2Token
        : undefined;

      // Always generate an OAuth2 client for making requests.
      // It will attempt to generate its own tokens.
      return new OAuth2(
        {
          grantType: "client_credentials",
          tokenEndpoint: "https://api.tailscale.com/api/v2/oauth/token",
          clientId: clientId,
          clientSecret: clientSecret,

          onTokenUpdate: function (token: OAuth2Token) {
            // Persist updated tokensin the data store.
            client.apps.datastore.put<AccessToken>({
              datastore: TailscaleTokenStore.name,
              item: {
                client_id: clientId,
                access_token: token.accessToken,
                refresh_token: token.refreshToken,
                expires_at: token.expiresAt
                  ? token.expiresAt / 1000
                  : undefined,
              },
            }).catch((err) =>
              console.error("Error persisting tailscale access token:", err)
            );
          },
        },
        tok,
      );
    });

  // Inject our user-agent to the fetch the requests.
  return (
    input: RequestInfo,
    init?: TailscaleRequestInit,
  ): Promise<Response> => {
    // The actual request.
    const method = init?.method?.toUpperCase() || "GET";
    const headers = new Headers(init?.headers);
    headers.set("User-Agent", ua);
    const res = ts.then((c) => c.fetch(input, { ...init, method, headers }));

    // Just use the request, if we can't or don't want to check the cache.
    if (!init?.cacheSeconds || method != "GET") {
      return res;
    }

    if (init.cacheSeconds) {
      throw new Error("cacheSeconds is still a work-in-progress");
    }

    // Multiple consumers want the body - read it only once.
    const resBody = res
      .then(async (res) => ({ res, body: await res.text() }));

    // When the response completes, update the response cache.
    const key = clientId + ":" + (new Request(input, init).url);
    resBody.then(({ res, body }) =>
      writeResponseCache(client, key, init.cacheSeconds!, res, body)
    ).catch(() => {
      // Swallow these errors - the returned promise will include it.
    });

    return Promise.any([
      readResponseCache(client, key),
      resBody.then(({ res, body }) =>
        new Response(body, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        })
      ),
    ]);
  };
}

async function writeResponseCache(
  client: SlackAPIClient,
  key: string,
  ttlSeconds: number,
  res: Response,
  body: string,
) {
  // Only cache good, re-usable responses.
  if (res.status != 200 && res.status !== 201) {
    console.log(`tscache skip: key=${key}: ${res.statusText}`);
    return;
  }

  // DynamoDB which backs the Slack datastores have an item limit of 400KB,
  // and we need to save a small amount of space for the other properties
  // we write into it.
  const len = body.length;
  if (len > 400_000) {
    console.log(`tscache skip: key=${key} len=${len}: too large`);
    return;
  }

  try {
    // TODO(icio): use a different datastore than the access token.
    const r = await client.apps.datastore.put<AccessToken>({
      datastore: TailscaleTokenStore.name,
      item: {
        client_id: key,
        expires_at: Date.now() / 1000 + ttlSeconds,
        access_token: JSON.stringify({
          status: res.status,
          statusText: res.statusText,
          headers: [...res.headers.entries()],
          body: body,
        }),
      },
    });
    if (!r.ok) {
      console.error(`tscache error: key=${key} len=${len}:`, r.error);
      return;
    }
    console.debug(`tscache updated: key=${key} len=${len}`);
  } catch (exc) {
    console.error(`tscache error: key=${key} len=${len}:`, exc);
  }
}

function readResponseCache(
  client: SlackAPIClient,
  key: string,
): Promise<Response> {
  // TODO(icio): use a different datastore than the access token.
  return client.apps.datastore.get<AccessToken>({
    datastore: TailscaleTokenStore.name,
    id: key,
  })
    .then((got) => {
      if (!got.ok) throw new Error(got.error);
      if (!got.item) throw new Error("no item");
      if (got.item.expires_at * 1000 < Date.now()) {
        throw new Error("cache expired");
      }
      if (!got.item.access_token) {
        throw new Error("empty item access_token");
      }
      console.debug(`tscache: read: key=${key}:`, got.item);
      const { body, ...init } = JSON.parse(got.item.access_token);
      return new Response(body, init);
    })
    .catch((err) => {
      console.error(`tscache read error: key=${key}:`, err);
      throw err;
    });
}

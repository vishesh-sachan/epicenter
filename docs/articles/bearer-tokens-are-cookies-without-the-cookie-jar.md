# Bearer Tokens Are Cookies Without the Cookie Jar

A bearer token is a session cookie sent as a header instead of a cookie. To behave like a cookie, it needs the same two properties: included in every request, and persisted across requests. Since there's no cookie jar to handle that automatically, you store the token yourself (local storage, a file, a Rust variable) and read it back into the `Authorization` header before each request.

```
Cookie:                               Bearer token:

  Set-Cookie: session=abc123            { "token": "abc123" }
  ↓                                     ↓
  Browser stores in cookie jar          You store in localStorage
  ↓                                     ↓
  Browser sends automatically:          You send manually:
  Cookie: session=abc123                Authorization: Bearer abc123
  ↓                                     ↓
  Server reads cookie                   Server reads header
  ↓                                     ↓
  DB lookup → user                      DB lookup → user
```

Same token. Same server-side validation. Same result. The only difference is who's responsible for storage and delivery.

## Cookies are automatic; bearer tokens are manual
With cookies, the browser does everything. You sign in, the server responds with `Set-Cookie: session=abc123`, and every subsequent request to that domain carries it. Zero code.

With bearer tokens, you do the two jobs yourself: persist the token, and include it on every request. This is why Better Auth's docs tell you to extract the token on sign-in and store it:

```typescript
const { data } = await authClient.signIn.email({
  email: "user@example.com",
  password: "securepassword"
}, {
  onSuccess: (ctx) => {
    // Get the token from the response headers
    const authToken = ctx.response.headers.get("set-auth-token");
    // Store the token securely (e.g., in localStorage)
    localStorage.setItem("bearer_token", authToken);
  }
});
```

And then configure the client to read it back and include it in every request:

```typescript
export const authClient = createAuthClient({
  fetchOptions: {
    auth: {
      type: "Bearer",
      token: () => localStorage.getItem("bearer_token") || ""
    }
  }
});
```

That's the whole pattern. Extract the token, store it, read it back into the header. You're doing what the cookie jar does, manually.
Three steps instead of zero. So why bother?

## Cookies break outside the browser

The cookie jar is a browser feature. It handles `Set-Cookie` parsing, `SameSite` policies, `Secure` flags, domain scoping, expiry, and cross-origin rules. Browsers have spent decades getting this right.

Desktop apps don't have a cookie jar. Tauri uses the system webview (WebKit on macOS, WebView2 on Windows), and each has its own problems:

| Problem                                           | What happens                              |
| ------------------------------------------------- | ----------------------------------------- |
| WebKit rejects `Secure` cookies from `tauri://`   | Cookie silently vanishes. No error.       |
| Webview and Rust HTTP have separate cookie stores | Sign in via one, the other doesn't know.  |
| Debug builds work, release builds don't           | Cookie persistence changes between modes. |

Bearer tokens sidestep all of this. The token is a string. Put it anywhere. Read it back. Attach it. No cookie machinery, no platform quirks.

## How Better Auth bridges the gap

Better Auth is cookie-first, but its `bearer()` plugin makes it work for non-browser clients. When the plugin is active, the sign-in response includes the token in three places:

```
HTTP/1.1 200 OK
Set-Cookie: session_token=abc123    ← for browsers
set-auth-token: abc123              ← response header for native apps
Content-Type: application/json

{ "token": "abc123", "user": {...} } ← response body
```

The native client ignores `Set-Cookie` and grabs the token from the body or header. On subsequent requests, the bearer plugin intercepts `Authorization: Bearer abc123`, converts it to a cookie internally, and hands it to Better Auth's normal session logic:

```
Tauri App              bearer() plugin              Better Auth
    │                       │                           │
    │  Authorization:       │                           │
    │  Bearer abc123   ────►│  convert to cookie   ────►│  getSession()
    │                       │  header internally        │  ↓
    │◄── 200 ───────────────│◄── user session ─────────│  DB lookup
```

Better Auth doesn't know the token came from a header. It thinks it read a cookie. Same validation, same session, same user.

## The mental model

A session cookie is a token with automatic delivery. A bearer token is the same token with manual delivery. Persistence moves from the cookie jar to your app's storage. Transport moves from `Cookie:` to `Authorization:`. Everything else is identical: token format, server validation, session lifetime, revocation.

Browsers: use cookies. Everything else: use bearer tokens.

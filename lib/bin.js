#!/usr/bin/env node
import { E as WorkBuddyCredentialStore, F as WORKBUDDY_VARIANTS, I as variantFor, M as atRestKeyProviderFor, P as CN_VARIANT, S as FALLBACK_WORKBUDDY_MODELS, U as WorkBuddyUpstreamClient, _ as readHostHeartbeat, a as openInBrowser, b as WORKBUDDY_CONNECT_VERSION, c as resolveIssuedDomain, d as startAuthorization, f as writeSigninDocument, h as isHeartbeatProcessAlive, l as signinEndpointsFor, n as claimDailyCheckin, o as pollAuthorization, pt as resolveAppVersion, r as fetchAccount, s as queryCheckinStatus, t as buildSigninDocument, u as signinPathFor, v as workbuddyHostHeartbeatPath, x as FALLBACK_WORKBUDDY_AI_MODELS } from "./signin-BzvGGGBk.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
//#region src/bin.ts
/** Standalone status/diagnostics CLI for the dsh-workbuddy-connect bundle. */
const JSON_SCHEMA_VERSION = 1;
/** Remove token-like strings from an unexpected diagnostic message. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]");
}
function printHelp() {
	process.stdout.write([
		"Usage: dsh-workbuddy-connect <checkin|doctor|login|logout|status> [options]",
		"",
		"  doctor   secret-free sign-in and environment diagnostics",
		"  status   sign-in state, remaining WorkBuddy credit, and host-bundle health",
		"  login    sign in over HTTPS and write a plaintext credential (no desktop app needed)",
		"  checkin  query the daily check-in reward; --claim to claim it when available",
		"  logout   remove the plugin-owned credential copy (the desktop app keeps its sign-in)",
		"",
		"  --provider  which product to inspect; defaults to workbuddy",
		`              one of: ${WORKBUDDY_VARIANTS.map((variant) => variant.id).join(", ")}`,
		"  --json      emit one secret-free JSON document (doctor/status/login/checkin)",
		"  --no-open   login: print the sign-in URL instead of opening a browser",
		"  --claim     checkin: actually claim the reward, not just query it",
		""
	].join("\n"));
}
function printJson(value) {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}
/**
* One variant's store plus the client that performs its refreshes.
*
* The key provider is built by the same shared helper the plugin host uses,
* so the CLI's `doctor`/`status` and the browser card can never disagree
* about which product's Electron a variant resolves.
*/
function makeStore(variant) {
	const client = new WorkBuddyUpstreamClient();
	return new WorkBuddyCredentialStore({
		variant,
		refresh: (credential) => client.refreshToken(credential),
		keyProvider: atRestKeyProviderFor(variant)
	});
}
/** The plugin-owned credential copy for one variant, for display. */
function ownAuthPath(variant) {
	return makeStore(variant).ownAuthPath();
}
/** Fallback roster size for one variant. */
function fallbackCount(variant) {
	return variant.id === CN_VARIANT.id ? FALLBACK_WORKBUDDY_MODELS.length : FALLBACK_WORKBUDDY_AI_MODELS.length;
}
async function doctor(jsonOutput, variant) {
	const store = makeStore(variant);
	const status = await store.status();
	const desktopPresent = await store.desktopFilePresent();
	const desktopFormat = await store.desktopAuthFormat();
	const desktopPath = await store.resolvedDesktopAuthPath() ?? store.desktopAuthPath();
	const heartbeat = await readHostHeartbeat();
	const hostAlive = heartbeat !== void 0 && isHeartbeatProcessAlive(heartbeat);
	const appVersion = variant.region === "global" ? await resolveAppVersion() : void 0;
	const decryptionNote = status.state === "signed-out" && desktopFormat === "encrypted" && status.reason !== void 0 ? `Encrypted desktop credential could not be used: ${status.reason}` : void 0;
	const report = {
		schemaVersion: JSON_SCHEMA_VERSION,
		package: "dsh-workbuddy-connect",
		version: WORKBUDDY_CONNECT_VERSION,
		node: process.version,
		provider: variant.id,
		displayName: variant.displayName,
		desktopAuthFile: {
			path: desktopPath ?? `(no platform default; set ${variant.env})`,
			present: desktopPresent,
			format: desktopFormat
		},
		ownAuthFile: ownAuthPath(variant),
		...appVersion === void 0 ? {} : { catalogUserAgent: {
			version: appVersion.version,
			source: appVersion.source,
			...appVersion.bundle === void 0 ? {} : { bundle: appVersion.bundle }
		} },
		hostHeartbeat: {
			path: workbuddyHostHeartbeatPath(),
			present: heartbeat !== void 0,
			...heartbeat === void 0 ? {} : {
				registeredAt: heartbeat.registeredAt,
				pid: heartbeat.pid
			},
			processAlive: hostAlive
		},
		signIn: status.state,
		fallbackModels: fallbackCount(variant),
		hints: [
			...decryptionNote !== void 0 ? [decryptionNote] : status.state === "signed-out" ? [`Sign in once in the ${variant.appName} desktop app, then run status again.`] : [],
			...desktopPresent ? [] : [`No ${variant.appName} desktop auth file at the expected path; set ${variant.env} if it lives elsewhere.`],
			...hostAlive ? [] : ["Host bundle not running in this DSH profile (or the process exited). The browser card and provider are unavailable until DSH starts the plugin."]
		]
	};
	if (jsonOutput) printJson({
		...report,
		...decryptionNote === void 0 ? {} : { decryptionNote }
	});
	else process.stdout.write([
		`${variant.displayName} Connect ${WORKBUDDY_CONNECT_VERSION} on ${process.version}`,
		`Desktop auth file: ${report.desktopAuthFile.present ? "present" : "missing"} — ${desktopFormat} (${report.desktopAuthFile.path})`,
		`Host bundle: ${hostAlive ? `running (pid ${heartbeat.pid})` : heartbeat !== void 0 ? "stale heartbeat (process exited)" : "not started"}`,
		`Sign-in state: ${report.signIn}`,
		`Static fallback models: ${report.fallbackModels}`,
		...appVersion === void 0 ? [] : [`Catalog User-Agent version: ${appVersion.version} (${appVersion.source})`],
		...report.hints.map((hint) => `Hint: ${hint}`),
		""
	].join("\n"));
	return status.state === "signed-in" && desktopPresent ? 0 : 1;
}
async function status(jsonOutput, variant) {
	const store = makeStore(variant);
	const client = new WorkBuddyUpstreamClient();
	const authStatus = await store.status();
	const heartbeat = await readHostHeartbeat();
	const hostAlive = heartbeat !== void 0 && isHeartbeatProcessAlive(heartbeat);
	const hostState = hostAlive ? "running" : heartbeat !== void 0 ? "stale" : "not-started";
	if (authStatus.state !== "signed-in") {
		if (jsonOutput) printJson({
			schemaVersion: JSON_SCHEMA_VERSION,
			package: "dsh-workbuddy-connect",
			version: WORKBUDDY_CONNECT_VERSION,
			provider: variant.id,
			status: "signed-out",
			hostBundle: hostState
		});
		else process.stdout.write(`${variant.displayName} Connect: signed out\nHost bundle: ${hostState}\n`);
		return 1;
	}
	let credits;
	try {
		const credential = await store.current();
		if (credential !== void 0) {
			const fetched = await client.fetchCredits(credential);
			credits = {
				total: fetched.total,
				...fetched.unlimited === true ? { unlimited: true } : {}
			};
		}
	} catch (error) {
		credits = {
			total: 0,
			error: safeMessage(error)
		};
	}
	const expiresAt = authStatus.expiresAtMs !== void 0 ? new Date(authStatus.expiresAtMs).toISOString() : void 0;
	if (jsonOutput) {
		printJson({
			schemaVersion: JSON_SCHEMA_VERSION,
			package: "dsh-workbuddy-connect",
			version: WORKBUDDY_CONNECT_VERSION,
			provider: variant.id,
			status: "signed-in",
			...expiresAt === void 0 ? {} : { accessTokenExpires: expiresAt },
			...authStatus.nickname === void 0 ? {} : { nickname: authStatus.nickname },
			...authStatus.domain === void 0 || authStatus.domain === "" ? {} : { domain: authStatus.domain },
			source: authStatus.source,
			credits: credits?.total,
			...credits?.unlimited === true ? { creditsUnlimited: true } : {},
			...credits?.error === void 0 ? {} : { creditsError: credits.error },
			hostBundle: hostState
		});
		return 0;
	}
	process.stdout.write([
		`${variant.displayName} Connect: signed in${authStatus.nickname === void 0 ? "" : ` as ${authStatus.nickname}`}`,
		...expiresAt === void 0 ? [] : [`Access token expires ${expiresAt} (refresh is automatic)`],
		credits?.error !== void 0 ? `Remaining credit: unavailable (${credits.error})` : credits?.unlimited === true ? "Remaining credit: unlimited" : `Remaining credit: ${credits?.total ?? "unknown"}`,
		`Host bundle: ${hostAlive ? `running (pid ${heartbeat.pid})` : hostState === "stale" ? "stale heartbeat (DSH process exited)" : "not started in this profile"}`,
		"Client card: load failures are logged to the browser console only; the host provider is unaffected.",
		""
	].join("\n"));
	return 0;
}
/**
* Sign in over plain HTTPS and persist a plaintext credential.
*
* The point of doing this here is that it removes the plugin's only hard
* dependency on the desktop app: the credential written below is readable by
* {@link WorkBuddyCredentialStore} without ever launching an Electron binary,
* so the app can be uninstalled once this succeeds.
*/
async function login(variant, options) {
	const endpoints = signinEndpointsFor(variant);
	const request = await startAuthorization(variant, endpoints);
	if (options.json) printJson({
		schemaVersion: JSON_SCHEMA_VERSION,
		package: "dsh-workbuddy-connect",
		version: WORKBUDDY_CONNECT_VERSION,
		provider: variant.id,
		status: "awaiting-browser",
		authUrl: request.authUrl,
		...request.notes.length === 0 ? {} : { notes: request.notes },
		signinFile: signinPathFor(variant)
	});
	else {
		process.stdout.write([
			`Signing in to ${variant.displayName} (${endpoints.base})`,
			"",
			"Open this URL in a browser to continue:",
			"",
			`  ${request.authUrl}`,
			"",
			...request.notes.length === 0 ? [] : [`  (link corrected: ${request.notes.join("; ")})`],
			`  Copy the WHOLE link: a truncated URL is reported by the page as an incomplete sign-in link.`,
			""
		].join("\n"));
		if (options.open) process.stdout.write(openInBrowser(request.authUrl) ? "  (browser launch attempted; copy the URL manually if nothing opened)\n\n" : "  (could not launch a browser; copy the URL above)\n\n");
	}
	const tokens = await pollAuthorization(variant, request.state, {
		timeoutMs: options.timeoutSec * 1e3,
		endpoints,
		onTick: (secondsLeft, note) => {
			if (options.json) return;
			process.stdout.write(`\r  waiting for the browser… ${secondsLeft}s   ${note ?? ""}`);
		}
	});
	if (!options.json) process.stdout.write("\r  signed in, finishing…                    \n");
	const account = await fetchAccount(variant, request.state, tokens.accessToken, { endpoints });
	const domain = resolveIssuedDomain(variant, tokens.domain);
	const document = buildSigninDocument({
		tokens,
		account,
		domain
	});
	const path = signinPathFor(variant);
	await writeSigninDocument(path, document);
	if (options.json) {
		printJson({
			schemaVersion: JSON_SCHEMA_VERSION,
			package: "dsh-workbuddy-connect",
			version: WORKBUDDY_CONNECT_VERSION,
			provider: variant.id,
			status: "signed-in",
			signinFile: path,
			domain,
			...account.nickname === void 0 ? {} : { nickname: account.nickname },
			...tokens.expiresAtMs === void 0 ? {} : { accessTokenExpires: new Date(tokens.expiresAtMs).toISOString() },
			...tokens.refreshExpiresAtMs === void 0 ? {} : { refreshTokenExpires: new Date(tokens.refreshExpiresAtMs).toISOString() }
		});
		return 0;
	}
	process.stdout.write([
		`Signed in to ${variant.displayName}${account.nickname === void 0 ? "" : ` as ${account.nickname}`}.`,
		`Credential written to ${path} (mode 0600).`,
		...tokens.expiresAtMs === void 0 ? [] : [`Access token expires ${new Date(tokens.expiresAtMs).toISOString()} (refresh is automatic).`],
		...tokens.refreshExpiresAtMs === void 0 ? ["The upstream did not report a refresh expiry; re-run login when the token eventually lapses."] : [`Refresh token expires ${new Date(tokens.refreshExpiresAtMs).toISOString()}.`],
		"",
		"Next: point the plugin at it and restart DSH so the profile sees the variable:",
		"",
		`  [Environment]::SetEnvironmentVariable('${variant.env}', '${path}', 'User')`,
		"",
		"The desktop app is no longer required for this product once that works.",
		""
	].join("\n"));
	return 0;
}
/** Query (and optionally claim) the daily check-in reward. */
async function checkin(variant, options) {
	const store = makeStore(variant);
	if ((await store.status()).state !== "signed-in") {
		if (options.json) printJson({
			schemaVersion: JSON_SCHEMA_VERSION,
			package: "dsh-workbuddy-connect",
			version: WORKBUDDY_CONNECT_VERSION,
			provider: variant.id,
			status: "signed-out"
		});
		else process.stdout.write(`${variant.displayName}: signed out; run login first.\n`);
		return 1;
	}
	const credential = await store.current();
	if (credential === void 0) {
		process.stderr.write("dsh-workbuddy-connect: no usable credential\n");
		return 1;
	}
	const view = {
		accessToken: credential.accessToken,
		...credential.uid === "" ? {} : { uid: credential.uid },
		...credential.enterpriseId === void 0 ? {} : { enterpriseId: credential.enterpriseId },
		domain: credential.domain
	};
	const endpoints = signinEndpointsFor(variant);
	const queried = await queryCheckinStatus(variant, view, endpoints);
	const httpStatus = queried.raw.status;
	const reached = queried.raw.ok || queried.raw.status !== 0;
	if (options.json) {
		const claimed = options.claim && queried.checkedToday !== true && reached ? await claimDailyCheckin(variant, view, queried, endpoints) : void 0;
		printJson({
			schemaVersion: JSON_SCHEMA_VERSION,
			package: "dsh-workbuddy-connect",
			version: WORKBUDDY_CONNECT_VERSION,
			provider: variant.id,
			status: "checked",
			reachable: reached,
			httpStatus,
			...queried.checkedToday === void 0 ? {} : { checkedToday: queried.checkedToday },
			...queried.streakDays === void 0 ? {} : { streakDays: queried.streakDays },
			...claimed === void 0 ? {} : { claim: claimed }
		});
		return reached ? 0 : 1;
	}
	const lines = [`${variant.displayName} check-in (no X-Device-Token is sent):`];
	if (!reached) {
		lines.push("  the endpoint was unreachable; check connectivity and retry.", "");
		process.stdout.write(lines.join("\n"));
		return 1;
	}
	lines.push(`  status query: HTTP ${httpStatus}${queried.raw.code === void 0 ? "" : `, code ${queried.raw.code}`}`);
	if (queried.checkedToday !== void 0) lines.push(`  checked in today: ${queried.checkedToday ? "yes" : "no"}`);
	if (queried.streakDays !== void 0) lines.push(`  consecutive days: ${queried.streakDays}`);
	if (httpStatus === 401 || httpStatus === 403) {
		lines.push("", "  Rejected by device risk control (401/403).", "  The check-in endpoint wants X-Device-Token, a native risk-control", "  fingerprint that cannot be produced outside the vendor SDK.", "  Conclusion: automated check-in is not available for this account.", "");
		process.stdout.write(lines.join("\n"));
		return 1;
	}
	if (!queried.raw.ok || queried.raw.code !== void 0 && queried.raw.code !== 0) {
		lines.push("", `  the query did not succeed: ${queried.raw.msg ?? "(no message)"}`, "");
		process.stdout.write(lines.join("\n"));
		return 1;
	}
	if (!options.claim) {
		lines.push("", "  (read-only; pass --claim to claim the reward)", "");
		process.stdout.write(lines.join("\n"));
		return 0;
	}
	if (queried.checkedToday === true) {
		lines.push("", "  already claimed today.", "");
		process.stdout.write(lines.join("\n"));
		return 0;
	}
	const outcome = await claimDailyCheckin(variant, view, queried, endpoints);
	const closing = [""];
	let code = 0;
	switch (outcome.state) {
		case "claimed":
			closing.push(`  claimed${outcome.credits === void 0 ? "" : ` ${outcome.credits}`}.`, "", "  automated check-in works for this account.");
			break;
		case "already":
			closing.push("  already claimed today (the upstream reports this as a business error; it is normal).");
			break;
		case "no-activity":
			closing.push("  The upstream reports no check-in activity (or it has lapsed).", "  This matches the status query saying \"not yet\", so it is not a failure:", "  this product simply has no check-in to perform.");
			break;
		case "blocked":
			closing.push(`  rejected by device risk control (HTTP ${outcome.status}); automated check-in is not available.`);
			code = 1;
			break;
		case "unreachable":
			closing.push(`  the claim request did not complete: ${outcome.error}`);
			code = 1;
			break;
		case "failed":
			closing.push(`  the claim did not succeed: HTTP ${outcome.status}${outcome.code === void 0 ? "" : `, code ${outcome.code}`}${outcome.message === void 0 ? "" : `: ${outcome.message}`}`);
			code = 1;
	}
	closing.push("");
	process.stdout.write(lines.concat(closing).join("\n"));
	return code;
}
/** Execute one boot-free command. */
async function run(argv) {
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
		printHelp();
		return 0;
	}
	const [rawAction, ...flags] = argv;
	if (![
		"checkin",
		"doctor",
		"login",
		"logout",
		"status"
	].includes(rawAction)) {
		process.stderr.write(`dsh-workbuddy-connect: expected checkin, doctor, login, logout, or status; got ${JSON.stringify(rawAction)}\n`);
		return 1;
	}
	const action = rawAction;
	const jsonOutput = flags.includes("--json");
	const claim = flags.includes("--claim");
	const noOpen = flags.includes("--no-open");
	let providerId;
	const rest = [];
	for (let index = 0; index < flags.length; index += 1) {
		const flag = flags[index];
		if (flag === "--provider") {
			providerId = flags[index + 1];
			index += 1;
			continue;
		}
		if (flag.startsWith("--provider=")) {
			providerId = flag.slice(11);
			continue;
		}
		rest.push(flag);
	}
	const variant = providerId === void 0 ? CN_VARIANT : variantFor(providerId);
	if (variant === void 0) {
		process.stderr.write(`dsh-workbuddy-connect: unknown provider ${JSON.stringify(providerId)}; expected one of ${WORKBUDDY_VARIANTS.map((v) => v.id).join(", ")}\n`);
		return 1;
	}
	const allowed = {
		doctor: ["--json"],
		status: ["--json"],
		logout: [],
		login: ["--json", "--no-open"],
		checkin: ["--json", "--claim"]
	}[action];
	const unknown = rest.filter((flag) => !allowed.includes(flag));
	if (unknown.length > 0) {
		process.stderr.write(`dsh-workbuddy-connect: invalid options for ${action}: ${unknown.join(" ")}\n`);
		return 1;
	}
	try {
		switch (action) {
			case "doctor": return await doctor(jsonOutput, variant);
			case "status": return await status(jsonOutput, variant);
			case "login": return await login(variant, {
				open: !noOpen,
				timeoutSec: 300,
				json: jsonOutput
			});
			case "checkin": return await checkin(variant, {
				claim,
				json: jsonOutput
			});
			case "logout": {
				const store = makeStore(variant);
				await store.logout();
				process.stdout.write(`${variant.displayName} Connect: removed ${store.ownAuthPath()}; the desktop app's sign-in is untouched\n`);
				return 0;
			}
		}
	} catch (error) {
		process.stderr.write(`dsh-workbuddy-connect: ${action} failed: ${safeMessage(error)}\n`);
		return 1;
	}
}
if (process.argv[1] !== void 0 && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) process.exitCode = await run(process.argv.slice(2));
//#endregion
export { run };

window.__ModuleLoader__.load({
	id: "dsh-workbuddy-connect",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/status-paths.ts
		/** Node-free constants and types shared by the Host and browser halves. */
		/** Plugin-owned status endpoint consumed by its browser half. */
		const WORKBUDDY_STATUS_PATH = "/plugins/dsh-workbuddy-connect/status";
		/**
		* Plugin-owned probe control endpoint.
		*
		* Separate from the status route because it accepts writes: the status route's
		* loopback Host/Origin guard protects against a DNS-rebinding *page*, which is
		* not the same as authorizing a state-changing action. This route therefore
		* also requires the in-process key the browser half receives with the status
		* document.
		*/
		const WORKBUDDY_PROBE_PATH = "/plugins/dsh-workbuddy-connect/probe";
		/**
		* The international (WorkBuddy AI) variant's own pair of routes.
		*
		* Kept as separate constants rather than a computed suffix so both halves
		* reference literal strings: the browser bundle and the host bundle are built
		* independently, and a shared expression is one build-config drift away from
		* the desk asking a route the host never mounted.
		*/
		const WORKBUDDY_AI_STATUS_PATH = "/plugins/dsh-workbuddy-connect/ai/status";
		const WORKBUDDY_AI_PROBE_PATH = "/plugins/dsh-workbuddy-connect/ai/probe";
		/** Every reason code, for validation without trusting a wire value. */
		const SIGNED_OUT_REASON_CODES = [
			"no-credential",
			"credential-region-mismatch",
			"encrypted-credential-unreadable",
			"electron-binary-not-found",
			"electron-binary-ambiguous",
			"electron-binary-unavailable",
			"electron-path-invalid",
			"electron-discovery-incomplete"
		];
		/** Whether a value is one of the closed set of signed-out reason codes. */
		function isWorkBuddySignedOutReasonCode(value) {
			return typeof value === "string" && SIGNED_OUT_REASON_CODES.includes(value);
		}
		//#endregion
		//#region src/client/status-document.ts
		/**
		* Whether a parsed status response really is a status document.
		*
		* A 200 is not a promise about the body: it may be empty, literal `null`, a
		* non-JSON page from a proxy, or an array. Both halves of the browser plugin
		* read the same route, so both must agree on what is valid — storing an
		* unreadable value puts something in state that the next render dereferences.
		*
		* The check is deliberately limited to the discriminator (plus `error`'s
		* `message`, which the error paragraph renders): validating optional fields
		* here would reject documents the host legitimately omits fields from.
		*
		* `reasonCode` is therefore *not* rejected here — a card renders `reason`
		* either way — but every reader must narrow it with
		* `isWorkBuddySignedOutReasonCode` before branching on it, since the wire
		* value is not guaranteed to be inside the enum.
		*/
		function isWorkBuddyWebStatus(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const wrapped = value;
			const status = wrapped["status"];
			if (status === "signed-out" || status === "signed-in") return true;
			return status === "error" && typeof wrapped["message"] === "string";
		}
		//#endregion
		//#region src/client/WorkBuddyPluginCard.tsx
		/**
		* WorkBuddy status card, rendered on whichever settings surface the host
		* provides: dispatched directly by DSH 0.1.5's settings Plugins tab (one card
		* per variant), or mounted by the bundle configuration page DSH 0.1.6+'s
		* Plugins page renders. The component itself is surface-agnostic — its props
		* are only the injected copy and variant.
		*/
		/** CN WorkBuddy; the plugin's long-standing card and default. */
		const CN_CARD_VARIANT = {
			id: "workbuddy",
			titleKey: "title",
			introKey: "intro",
			signedOutKey: "signedOutHint",
			statusPath: WORKBUDDY_STATUS_PATH,
			probePath: WORKBUDDY_PROBE_PATH,
			appName: "WorkBuddy",
			unavailableKey: "assistUnavailableCN",
			creditPrefix: "WB."
		};
		/** International WorkBuddy AI. */
		const AI_CARD_VARIANT = {
			id: "workbuddy-ai",
			titleKey: "titleAI",
			introKey: "introAI",
			signedOutKey: "signedOutHintAI",
			statusPath: WORKBUDDY_AI_STATUS_PATH,
			probePath: WORKBUDDY_AI_PROBE_PATH,
			appName: "WorkBuddy AI",
			unavailableKey: "assistUnavailableAI",
			creditPrefix: "WB AI."
		};
		/** Both cards, in display order. */
		const CARD_VARIANTS = [CN_CARD_VARIANT, AI_CARD_VARIANT];
		const POLL_INTERVAL_MS = 6e4;
		/**
		* The reason codes whose failures the Agent assist block covers: the plugin
		* cannot reach a decryption program, for any of the five reasons in §5.5.
		*
		* This is the *only* place the card decides whether the block applies. It
		* branches on the code, never on `reason` text: the prose is written for a
		* human and is expected to change, so matching it would silently stop
		* matching after any wording edit.
		*
		* `encrypted-credential-unreadable` is deliberately absent — the app was found
		* and ran, so "look for the app" is not the fix for it.
		*/
		const ASSIST_REASON_CODES = [
			"electron-binary-not-found",
			"electron-binary-ambiguous",
			"electron-binary-unavailable",
			"electron-path-invalid",
			"electron-discovery-incomplete"
		];
		/** Locale key for one failure's summary inside the Agent prompt. */
		function assistSummaryKey(code, variant) {
			switch (code) {
				case "electron-binary-not-found": return "assistNotFound";
				case "electron-binary-ambiguous": return "assistAmbiguous";
				case "electron-discovery-incomplete": return "assistIncomplete";
				case "electron-path-invalid": return "assistPathInvalid";
				default: return variant.unavailableKey;
			}
		}
		/** Copy text to the clipboard, reporting whether it worked. */
		async function copyPrompt(text) {
			try {
				if (navigator.clipboard?.writeText === void 0) return false;
				await navigator.clipboard.writeText(text);
				return true;
			} catch {
				return false;
			}
		}
		/**
		* The Agent assist block for a path failure: what is wrong, one copyable
		* request, and a re-check. Rendered only for the codes above.
		*/
		function AssistBlock({ t, variant, failureSummary, busy, onRecheck }) {
			const [copied, setCopied] = (0, react.useState)(false);
			const [copyFailed, setCopyFailed] = (0, react.useState)(false);
			const prompt = t("assistantPrompt", {
				appName: variant.appName,
				failureSummary
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: assistStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
						style: assistHeadingStyle,
						children: t("assistantHeading")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("assistantIntro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: assistPromptRowStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: assistPromptStyle,
							children: prompt
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							onClick: () => {
								(async () => {
									const ok = await copyPrompt(prompt);
									setCopied(ok);
									setCopyFailed(!ok);
								})();
							},
							children: t("assistantCopy")
						})]
					}),
					copied ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: assistFeedbackStyle,
						role: "status",
						children: t("assistantCopied")
					}) : null,
					copyFailed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: assistFeedbackStyle,
						role: "status",
						children: t("assistantCopyFailed")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("assistantAfter")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: rowStyle,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							disabled: busy,
							onClick: onRecheck,
							children: busy ? t("assistantRechecking") : t("assistantRecheck")
						})
					})
				]
			});
		}
		const cardStyle = {
			overflow: "hidden",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 10,
			background: "var(--dsw-alias-bg-module-platform)",
			listStyle: "none"
		};
		const headerStyle = {
			boxSizing: "border-box",
			width: "100%",
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 16,
			border: 0,
			padding: "13px 14px",
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			textAlign: "left",
			cursor: "pointer"
		};
		const headTextStyle = {
			display: "flex",
			minWidth: 0,
			flexDirection: "column",
			gap: 3
		};
		const nameStyle = {
			fontSize: 14,
			lineHeight: "20px",
			fontWeight: 600
		};
		const descriptionStyle = {
			fontSize: 13,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const chevronStyle = {
			flex: "0 0 auto",
			fontSize: 18,
			lineHeight: 1,
			transition: "transform 120ms ease"
		};
		const cardBodyStyle = {
			borderTop: "1px solid var(--dsw-alias-border-l2)",
			padding: "16px 14px 18px"
		};
		const bodyStyle = {
			margin: 0,
			fontSize: 14,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const rowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			flexWrap: "wrap",
			gap: 12
		};
		const statusStyle = {
			display: "flex",
			alignItems: "center",
			gap: 9,
			fontSize: 15,
			fontWeight: 500,
			color: "var(--dsw-alias-label-primary)"
		};
		const buttonStyle = {
			boxSizing: "border-box",
			minHeight: 34,
			padding: "6px 14px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 18,
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			fontSize: 14,
			cursor: "pointer"
		};
		const errorStyle = {
			...bodyStyle,
			color: "var(--dsw-alias-state-error-primary)"
		};
		const noticeStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 2,
			padding: "10px 12px",
			borderRadius: 8,
			border: "1px solid",
			fontSize: 13,
			lineHeight: "18px"
		};
		const noticeDetailStyle = {
			fontSize: 12,
			lineHeight: "16px",
			opacity: .8
		};
		const urgentNoticeStyle = {
			background: "var(--dsw-alias-state-warn-tertiary, #fff4e5)",
			borderColor: "var(--dsw-alias-state-warn-primary, #d97706)",
			color: "var(--dsw-alias-label-primary)"
		};
		const warnNoticeStyle = {
			background: "var(--dsw-alias-bg-l2, #f6f7f9)",
			borderColor: "var(--dsw-alias-border-l2)",
			color: "var(--dsw-alias-label-primary)"
		};
		const quotaListStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			paddingTop: 2
		};
		const quotaGroupStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10
		};
		const quotaTitleStyle = {
			margin: 0,
			fontSize: 14,
			lineHeight: "20px",
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)"
		};
		const quotaLabelStyle = {
			display: "flex",
			justifyContent: "space-between",
			gap: 12,
			fontSize: 13,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const modelBadgeStyle = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			flexWrap: "wrap"
		};
		const modelOfferStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 2
		};
		const modelRateStyle = {
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const contextPreferenceStyle = {
			display: "flex",
			alignItems: "flex-start",
			gap: 9,
			padding: "10px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			color: "var(--dsw-alias-label-primary)",
			fontSize: 13,
			lineHeight: "20px"
		};
		const contextPreferenceCopyStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 2
		};
		/**
		* The Agent assist block. Sits beside the existing error line rather than
		* replacing it: the short diagnosis stays the headline, this adds the way out.
		*/
		const assistStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10,
			padding: "12px 14px",
			marginTop: 12,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 10,
			background: "var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.04))"
		};
		const assistHeadingStyle = {
			margin: 0,
			fontSize: 14,
			lineHeight: "20px",
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)"
		};
		const assistPromptRowStyle = {
			display: "flex",
			flexWrap: "wrap",
			alignItems: "flex-start",
			gap: 8,
			padding: "8px 9px 8px 11px",
			borderRadius: 7,
			background: "var(--dsw-alias-bg-layer-1)"
		};
		const assistPromptStyle = {
			flex: "1 1 220px",
			minWidth: 0,
			margin: 0,
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "19px",
			whiteSpace: "pre-wrap",
			overflowWrap: "anywhere",
			userSelect: "text"
		};
		const assistFeedbackStyle = {
			margin: 0,
			fontSize: 12,
			lineHeight: "19px",
			color: "var(--dsw-alias-label-secondary)"
		};
		/**
		* Left half of one merged context/visibility row: the visibility checkbox (when
		* the account has one) beside the model's name and rate. Kept as a flex span so
		* the capacity column stays flush right no matter how long the name runs.
		*/
		const contextRowMainStyle = {
			display: "flex",
			alignItems: "center",
			gap: 9,
			minWidth: 0
		};
		const modelBadgeChipStyle = {
			padding: "1px 8px",
			borderRadius: 999,
			fontSize: 11,
			lineHeight: "18px",
			background: "var(--dsw-alias-state-success-subtle, rgba(34, 160, 107, 0.12))",
			color: "var(--dsw-alias-state-success-primary, #22a06b)"
		};
		/**
		* Localize an upstream promotional badge label, with an unknown-badge fallback.
		*
		* The CN catalog spells badges in Chinese (`限时免费`, `夜间折扣`); the
		* international document's `modelPromotions` carries English (`Free now`). Both
		* are mapped so the same promotion reads consistently in either UI language,
		* and anything else passes through verbatim — an unrecognized badge is still
		* information the upstream chose to show.
		*/
		function modelBadgeLabel(badge, t) {
			if (badge === "限时免费") return t("badgeLimitedFree");
			if (badge === "夜间折扣") return t("badgeNightDiscount");
			if (badge === "Free now") return t("badgeFreeNow");
			return badge;
		}
		const progressTrackStyle = {
			height: 8,
			overflow: "hidden",
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.08))"
		};
		/**
		* Tab strip for the card body. Kept visually light — a full pill would compete
		* with the section headings, and the card is already the densest surface the
		* plugin owns.
		*/
		const tabBarStyle = {
			display: "flex",
			gap: 4,
			marginTop: 4,
			borderBottom: "1px solid var(--dsw-alias-border-l2)"
		};
		const tabStyle = {
			padding: "6px 12px",
			border: 0,
			borderBottom: "2px solid transparent",
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary)",
			font: "inherit",
			fontSize: 13,
			lineHeight: "20px",
			cursor: "pointer"
		};
		const tabActiveStyle = {
			borderBottom: "2px solid var(--dsw-alias-brand-primary)",
			color: "var(--dsw-alias-label-primary)",
			fontWeight: 600
		};
		const tabPanelStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			paddingTop: 16
		};
		({ ...buttonStyle });
		function progressFillStyle(percent) {
			return {
				width: `${Math.max(0, Math.min(100, percent))}%`,
				height: "100%",
				borderRadius: "inherit",
				background: "var(--dsw-alias-brand-primary, #1677ff)"
			};
		}
		/**
		* Status dot colour. Takes `'loading'` as well as the document's own states:
		* before the first response the card knows nothing about the account, so it must
		* not borrow the signed-out grey — that would read as "nothing is wrong, nobody
		* is signed in" when the truth is "not read yet".
		*/
		function dotStyle(status) {
			return {
				width: 9,
				height: 9,
				borderRadius: "50%",
				flex: "0 0 auto",
				background: status === "signed-in" ? "var(--dsw-alias-state-success-primary, #22a06b)" : status === "error" ? "var(--dsw-alias-state-error-primary, #d92d20)" : "var(--dsw-alias-label-dimmed, #9aa0a6)"
			};
		}
		function formatNumber(value) {
			return new Intl.NumberFormat(void 0).format(value);
		}
		function formatTime(ms) {
			return new Intl.DateTimeFormat(void 0, {
				dateStyle: "medium",
				timeStyle: "short"
			}).format(new Date(ms));
		}
		function formatCycleReset(time) {
			const parsed = Date.parse(time);
			if (!Number.isNaN(parsed)) return formatTime(parsed);
			return time;
		}
		/**
		* A warning that credit is about to lapse.
		*
		* The total alone cannot express this: a package expiring in an hour and one
		* expiring next month both render as "500 credit", so a user watching only the
		* total loses the first one silently. The banner names the amount, the package
		* count and the soonest expiry, and escalates 7d → 24h.
		*
		* Only future horizons are covered: the billing query behind this returns
		* `valid` + `usedUp` packages from the current time forward, so an
		* already-lapsed package never reaches here.
		*
		* Renders nothing when the upstream reported no end times at all — absence of
		* expiry data is not evidence that nothing expires, so the component stays
		* silent rather than reassuring.
		*/
		function ExpiryNotice({ expiry, t }) {
			const { within24h, within7d } = expiry;
			let message;
			let soonest;
			let tone;
			if (within24h.packages > 0) {
				message = t("expiryWarningSoon", {
					total: formatNumber(Math.round(within24h.total * 100) / 100),
					packages: String(within24h.packages)
				});
				soonest = within24h.earliestEndTimeMs;
				tone = urgentNoticeStyle;
			} else if (within7d.packages > 0) {
				message = t("expiryWarningWeek", {
					total: formatNumber(Math.round(within7d.total * 100) / 100),
					packages: String(within7d.packages)
				});
				soonest = within7d.earliestEndTimeMs;
				tone = warnNoticeStyle;
			} else return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...noticeStyle,
					...tone
				},
				role: "status",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: message }), soonest === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: noticeDetailStyle,
					children: t("expiryExpiresAt", { time: formatTime(soonest) })
				})]
			});
		}
		/**
		* One billing package as a labeled progress bar.
		*
		* A package whose allowance the upstream never reported (`size` not positive)
		* has no percentage to state. It must not fall back to 100%: the plugin would be
		* claiming a full quota it knows nothing about, which is the opposite of the
		* honest "remaining N" line printed below it. Unknown size therefore renders the
		* percent slot as unknown copy and an unfilled, indeterminate track.
		*/
		function CreditBar({ label, remain, size, unlimited, t }) {
			if (unlimited === true) {
				const quotaText = t("unlimitedQuota");
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: quotaGroupStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: quotaLabelStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: quotaText })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: progressTrackStyle,
							role: "progressbar",
							"aria-label": label,
							"aria-valuetext": quotaText
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: bodyStyle,
							children: quotaText
						})
					]
				});
			}
			const sizeKnown = size > 0;
			const detail = sizeKnown ? t("exactRemaining", {
				remain: formatNumber(remain),
				size: formatNumber(size)
			}) : t("creditPackageUnknownSize", { remain: formatNumber(remain) });
			const percent = sizeKnown ? remain / size * 100 : void 0;
			const display = percent === void 0 ? t("percentUnknown") : t("percentRemaining", { percent: new Intl.NumberFormat(void 0, { maximumFractionDigits: 1 }).format(percent) });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: quotaGroupStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: quotaLabelStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: display })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: progressTrackStyle,
						role: "progressbar",
						"aria-label": label,
						...percent === void 0 ? { "aria-valuetext": detail } : {
							"aria-valuemin": 0,
							"aria-valuemax": 100,
							"aria-valuenow": percent
						},
						children: percent === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: progressFillStyle(percent) })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: detail
					})
				]
			});
		}
		/**
		* One model offer row: name, promotional badges, and the billing rate.
		*
		* The rate sits under the name rather than beside it because the row already
		* spends its horizontal budget on badges; stacking keeps long model names and
		* several badges from squeezing the rate into an ellipsis.
		*/
		function ModelOfferRow({ model, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: modelOfferStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: quotaLabelStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: modelBadgeStyle,
						children: [model.badges?.map((badge) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: modelBadgeChipStyle,
							children: modelBadgeLabel(badge, t)
						}, badge)), model.free === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: modelBadgeChipStyle,
							children: t("freeModel")
						}) : null]
					})]
				}), model.credits === void 0 ? model.rateUnknown === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: modelRateStyle,
					children: t("rateUnknown")
				}) : null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: modelRateStyle,
					children: t("rate", { rate: model.credits })
				})]
			});
		}
		/**
		* Context window and model visibility, one row per catalog model.
		*
		* The list is driven by the full current catalog, not by context metadata:
		* hiding a model is a statement about the picker, and a model without a
		* declared window is still hideable — its row just shows an em dash where the
		* capacity would be. Rows with a window keep the original ordering (largest
		* first); rows without one trail at the end in catalog order.
		*
		* Each row is one <label>, so the checkbox is named by its row without a
		* duplicated aria string. The checkbox state comes from the status document
		* only — no optimistic flip — so a save that fails leaves the box where the
		* host's truth says it is, next to the failure notice `control` records.
		* Checkboxes render only when the document carries a visibility section (a
		* signed-in account with a stable user id); a uid-less credential shows the
		* plain capacity list rather than editing a bucket every such account would
		* share.
		*
		* Purely a report of the upstream's own numbers otherwise. The plugin offers
		* no tier picker: the CN catalog declares one capacity per model and publishes
		* no alternatives, so a menu there would mean inventing client-side policy.
		* The international document does declare alternatives (`supportedLengths`),
		* and they are shown as a secondary figure rather than merged into one number —
		* the default is the budget actually requested, while the larger value is a
		* ceiling the upstream would accept.
		*/
		function ContextTable({ models, t, useMaximumContextWindow, contextPreferenceDisabled, onUseMaximumContextWindow, visibility, visibilityControlsDisabled, visibilityToggling, onVisibilityToggle }) {
			const rows = [...models ?? []].sort((a, b) => {
				if (a.contextWindow === void 0) return b.contextWindow === void 0 ? 0 : 1;
				if (b.contextWindow === void 0) return -1;
				return b.contextWindow - a.contextWindow;
			});
			const canSelectMaximum = rows.some((model) => model.maxContextWindow !== void 0 && model.maxContextWindow > (model.defaultContextWindow ?? model.contextWindow ?? 0));
			const showPreference = onUseMaximumContextWindow !== void 0 && (canSelectMaximum || useMaximumContextWindow === true);
			if (rows.length === 0 && !showPreference) return null;
			const hidden = new Set(visibility?.disabled ?? []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: quotaListStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						style: quotaTitleStyle,
						children: t("contextHeading")
					}),
					showPreference && onUseMaximumContextWindow !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: contextPreferenceStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: useMaximumContextWindow === true,
							disabled: contextPreferenceDisabled,
							onChange: (event) => {
								onUseMaximumContextWindow(event.currentTarget.checked);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: contextPreferenceCopyStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("useMaximumContextWindow") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: modelRateStyle,
								children: t("useMaximumContextWindowHint")
							})]
						})]
					}) : null,
					visibility === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("visibilityIntro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: quotaGroupStyle,
						children: rows.map((model) => {
							const capacity = model.contextWindow;
							const alternative = capacity !== void 0 && model.maxContextWindow !== void 0 && model.maxContextWindow > capacity ? model.maxContextWindow : void 0;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: quotaLabelStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: contextRowMainStyle,
									children: [visibility === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: !hidden.has(model.id),
										disabled: visibilityControlsDisabled || visibilityToggling.has(model.id),
										onChange: (event) => {
											onVisibilityToggle?.(model.id, event.currentTarget.checked);
										}
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: modelOfferStyle,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: modelBadgeStyle,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.name }),
												model.badges?.map((badge) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: modelBadgeChipStyle,
													children: modelBadgeLabel(badge, t)
												}, badge)),
												model.free === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: modelBadgeChipStyle,
													children: t("freeModel")
												}) : null
											]
										}), model.credits === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: modelRateStyle,
											children: model.credits
										})]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: modelOfferStyle,
									children: [capacity === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: modelRateStyle,
										"aria-label": t("contextUnknown"),
										children: "—"
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { textAlign: "right" },
										children: formatTokens(capacity)
									}), alternative !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: modelRateStyle,
										children: t("contextUpTo", { size: formatTokens(alternative) })
									}) : capacity !== void 0 && model.defaultContextWindow !== void 0 && model.defaultContextWindow < capacity ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: modelRateStyle,
										children: t("contextDefault", { size: formatTokens(model.defaultContextWindow) })
									}) : null]
								})]
							}, model.id);
						})
					})
				]
			});
		}
		/**
		* Compact token count for display: the catalog's own round numbers (`200000`,
		* `1000000`) read better as `200K` / `1M`, and no precision is lost because
		* these values are always whole thousands.
		*/
		function formatTokens(tokens) {
			if (tokens >= 1e6 && tokens % 1e6 === 0) return `${tokens / 1e6}M`;
			if (tokens >= 1e3 && tokens % 1e3 === 0) return `${tokens / 1e3}K`;
			return String(tokens);
		}
		/** Render WorkBuddy sign-in state and credit as one expandable card. */
		function WorkBuddyPluginCard({ t, variant = CN_CARD_VARIANT }) {
			if (t === void 0) throw new Error("WorkBuddy plugin card requires its translation function");
			const [open, setOpen] = (0, react.useState)(false);
			/**
			* The document to render. `undefined` means *not read yet*, which is a
			* distinct state from "signed out": seeding this with a signed-out document
			* told an already-signed-in user they were signed out for the whole first
			* round trip (and forever, if the read never settled).
			*/
			const [status, setStatus] = (0, react.useState)();
			/**
			* Whether the last **successful** read found a usable credential.
			*
			* Kept apart from `status` because the poll's liveness must depend on what the
			* account actually is, not on what the card last displayed: a failed read
			* leaves this untouched, so a transient failure cannot disarm the interval,
			* while a genuine signed-out answer still stops it.
			*
			* `undefined` therefore means "no successful read yet", which is also the
			* condition that decides whether a failed read has anything to preserve.
			*/
			const [signedIn, setSignedIn] = (0, react.useState)();
			/**
			* Why the most recent read failed, when it did. Rendered as a notice beside
			* whatever document is still on screen, rather than replacing it.
			*/
			const [readFailure, setReadFailure] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			/**
			* The model ids whose visibility writes are in flight, empty when none are.
			* Deliberately NOT the card-wide `busy` (that flag drives the Refresh
			* buttons' labels, which must not claim a refresh the user never pressed)
			* and deliberately per-row rather than whole-list: a visibility write only
			* adds or removes one model's id, so the rows are independent — locking
			* every checkbox for one row's write made the whole list visibly blink for
			* no correctness gain. A set, because two writes can be open at once when
			* the user moves down the list; only the rows being written lock.
			*/
			const [togglingModels, setTogglingModels] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [tab, setTab] = (0, react.useState)("status");
			const mounted = (0, react.useRef)(true);
			/**
			* Identity of the newest read that may write. Assigned when a read *starts*,
			* so a response is superseded by anything begun after it — "the response whose
			* request started last wins". Without this, a slow poll begun before a manual
			* action could settle after the action's own refresh and restore the older
			* document.
			*/
			const readSeq = (0, react.useRef)(0);
			/** Manual requests in flight, so unmount can abort them like the poll's. */
			const manualControllers = (0, react.useRef)(/* @__PURE__ */ new Set());
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
					for (const controller of manualControllers.current) controller.abort();
					manualControllers.current.clear();
				};
			}, []);
			/** Register a manual request's controller so unmount aborts it. */
			const trackController = (0, react.useCallback)(() => {
				const controller = new AbortController();
				manualControllers.current.add(controller);
				return controller;
			}, []);
			/**
			* Read the status document and apply it under the two policies the card's
			* correctness rests on:
			*
			* - a non-document body (empty, `null`, a non-JSON page) is a failed read, not
			*   something to store and then dereference in the render;
			* - a failed read never discards a document already on screen. It is recorded
			*   and shown as a notice beside that document; only when nothing has been
			*   read yet does the failure itself become the rendered state.
			*
			* Returns whether this read produced the current document.
			*/
			const refresh = (0, react.useCallback)(async (signal) => {
				const seq = ++readSeq.current;
				const current = () => mounted.current && signal?.aborted !== true && seq === readSeq.current;
				try {
					const response = await fetch(variant.statusPath, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					if (!isWorkBuddyWebStatus(value)) throw new Error(t("statusResponseInvalid"));
					if (!current()) return false;
					setStatus(value);
					if (value.status === "signed-in") setSignedIn(true);
					else if (value.status === "signed-out") setSignedIn(false);
					setReadFailure(void 0);
					return true;
				} catch (error) {
					const message = error instanceof Error ? error.message : t("requestFailed");
					if (current()) {
						setReadFailure(message);
						setStatus((previous) => previous === void 0 ? {
							status: "error",
							message
						} : previous);
					}
					return false;
				}
			}, [t, variant.statusPath]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const controller = new AbortController();
				refresh(controller.signal);
				return () => {
					controller.abort();
				};
			}, [open, refresh]);
			(0, react.useEffect)(() => {
				if (!open || signedIn === false) return;
				const controller = new AbortController();
				const timer = window.setInterval(() => {
					refresh(controller.signal);
				}, POLL_INTERVAL_MS);
				return () => {
					window.clearInterval(timer);
					controller.abort();
				};
			}, [
				open,
				refresh,
				signedIn
			]);
			const manualRefresh = async () => {
				setBusy(true);
				const controller = trackController();
				try {
					await refresh(controller.signal);
				} finally {
					manualControllers.current.delete(controller);
					if (mounted.current) setBusy(false);
				}
			};
			/**
			* Ask the host to re-read the credential and re-fetch this variant's catalog.
			*
			* Shares the probe route's key and guards: it is a write that spends an
			* upstream request, so it does not belong on the read-only status GET. A
			* failure is surfaced through the refreshed document's `catalog.error` rather
			* than thrown away, so the reason survives the round trip.
			*/
			const refreshModels = (0, react.useCallback)(async () => {
				const key = status?.status === "signed-in" ? status.probeKey : void 0;
				if (key === void 0) return;
				setBusy(true);
				const controller = trackController();
				try {
					const response = await fetch(variant.probePath, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Probe-Key": key
						},
						credentials: "same-origin",
						signal: controller.signal,
						body: JSON.stringify({ action: "refresh" })
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
				} catch (error) {
					if (mounted.current && controller.signal.aborted !== true) setReadFailure(error instanceof Error ? error.message : t("requestFailed"));
					manualControllers.current.delete(controller);
					return;
				} finally {
					if (mounted.current) setBusy(false);
				}
				try {
					await refresh(controller.signal);
				} finally {
					manualControllers.current.delete(controller);
				}
			}, [
				refresh,
				status,
				t,
				trackController,
				variant.probePath
			]);
			/**
			* Run one control action and refresh the card's state afterwards.
			*
			* The key travels in a header, not the body: it authorizes the write, and
			* the host validates every field against its own state and the signed-in
			* account before persisting anything.
			*/
			const control = (0, react.useCallback)(async (action) => {
				const key = status?.status === "signed-in" ? status.probeKey : void 0;
				if (key === void 0) return;
				const visibility = action.action === "set-model-visibility";
				if (visibility) setTogglingModels((previous) => new Set(previous).add(action.model));
				else setBusy(true);
				const controller = trackController();
				try {
					const response = await fetch(variant.probePath, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-Workbuddy-Probe-Key": key
						},
						credentials: "same-origin",
						signal: controller.signal,
						body: JSON.stringify(action)
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) {
						const message = typeof value === "object" && value !== null && "error" in value ? String(value["error"]) : `HTTP ${response.status}`;
						throw new Error(message);
					}
					if ((action.action === "set-maximum-context-window" || action.action === "set-model-visibility") && (typeof value !== "object" || value === null || value["state"] !== "updated")) {
						const state = typeof value === "object" && value !== null ? value["state"] : void 0;
						if (action.action === "set-model-visibility" && state === "stale-account") {
							await refresh(controller.signal);
							throw new Error(t("visibilityStaleAccount"));
						}
						const reason = typeof value === "object" && value !== null && "reason" in value ? String(value["reason"]) : t("requestFailed");
						throw new Error(reason);
					}
					await refresh(controller.signal);
				} catch (error) {
					if (mounted.current && controller.signal.aborted !== true) setReadFailure(error instanceof Error ? error.message : t("requestFailed"));
				} finally {
					manualControllers.current.delete(controller);
					if (!mounted.current) return;
					if (visibility) setTogglingModels((previous) => {
						const next = new Set(previous);
						next.delete(action.model);
						return next;
					});
					else setBusy(false);
				}
			}, [
				refresh,
				status,
				t,
				trackController,
				variant.probePath
			]);
			const title = t(variant.titleKey);
			/**
			* The failure the assist block covers, when this document has one. Computed
			* once so the block and the header's refresh button agree on whether the
			* block owns the re-check action — showing both would put two buttons with
			* the same effect side by side.
			*/
			const assistCode = status?.status === "signed-out" && isWorkBuddySignedOutReasonCode(status.reasonCode) && ASSIST_REASON_CODES.includes(status.reasonCode) ? status.reasonCode : void 0;
			const label = status === void 0 ? t("loading") : status.status === "signed-in" ? status.nickname === void 0 ? t("signedInAs", { nickname: "" }).trimEnd().replace(/[:：]$/, "") : t("signedInAs", { nickname: status.nickname }) : status.status === "error" ? t("requestFailed") : t("signedOut");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: cardStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					style: headerStyle,
					"aria-expanded": open,
					"aria-label": `${t(open ? "collapse" : "expand")}: ${title}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: headTextStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: nameStyle,
							children: title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: descriptionStyle,
							children: t(variant.introKey)
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						style: {
							...chevronStyle,
							transform: open ? "rotate(180deg)" : "none"
						},
						children: "⌄"
					})]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: cardBodyStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: quotaTitleStyle,
							children: t("accountHeading")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: rowStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: statusStyle,
								role: "status",
								"aria-busy": status === void 0,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									style: dotStyle(status === void 0 ? "loading" : status.status)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
							}), assistCode === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle,
								disabled: busy,
								onClick: () => {
									manualRefresh();
								},
								children: busy ? t("refreshing") : t("refresh")
							}) : null]
						}),
						readFailure === void 0 || signedIn === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: errorStyle,
							children: t("statusRefreshFailed", { message: readFailure })
						}),
						status?.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							status.expiresAt === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: bodyStyle,
								children: t("accessTokenExpires", { time: formatTime(status.expiresAt) })
							}),
							status.catalog === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: rowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: bodyStyle,
									children: [status.catalog.source === "live" && status.catalog.fetchedAt !== void 0 ? t("catalogLive", { time: formatTime(status.catalog.fetchedAt) }) : status.catalog.source === "saved" && status.catalog.fetchedAt !== void 0 ? t("catalogSaved", { time: formatTime(status.catalog.fetchedAt) }) : t("catalogFallback"), status.catalog.appVersion === void 0 ? "" : ` · ${t("catalogAppVersion", { version: status.catalog.appVersion })}`]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle,
									disabled: busy,
									onClick: () => {
										refreshModels();
									},
									children: busy ? t("refreshingModels") : t("refreshModels")
								})]
							}),
							status.catalog?.error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorStyle,
								children: t("catalogError", { message: status.catalog.error })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								role: "tablist",
								style: tabBarStyle,
								children: [
									"status",
									"context",
									"details"
								].map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									"aria-selected": tab === id,
									onClick: () => {
										setTab(id);
									},
									style: {
										...tabStyle,
										...tab === id ? tabActiveStyle : {}
									},
									children: t(id === "status" ? "tabStatus" : id === "context" ? "tabContext" : "tabDetails")
								}, id))
							}),
							tab === "status" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: tabPanelStyle,
								children: [status.credits === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: quotaListStyle,
									children: [
										status.credits.expiry === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExpiryNotice, {
											expiry: status.credits.expiry,
											t
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: rowStyle,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
												style: quotaTitleStyle,
												children: t("creditsHeading")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: bodyStyle,
												children: status.credits.unlimited === true ? t("creditsTotalUnlimited") : t("creditsTotal", { total: formatNumber(status.credits.total) })
											})]
										}),
										status.credits.cycleResetTime === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											style: descriptionStyle,
											children: t("cycleResetAt", { time: formatCycleReset(status.credits.cycleResetTime) })
										})
									]
								}), status.creditsError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: errorStyle,
									children: t("creditsError", { message: status.creditsError })
								})]
							}) : tab === "context" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: tabPanelStyle,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContextTable, {
									models: status.models,
									t,
									contextPreferenceDisabled: busy,
									...variant.id === AI_CARD_VARIANT.id && status.useMaximumContextWindow !== void 0 ? {
										useMaximumContextWindow: status.useMaximumContextWindow,
										onUseMaximumContextWindow: (enabled) => {
											control({
												action: "set-maximum-context-window",
												enabled
											});
										}
									} : {},
									visibility: status.visibility,
									visibilityControlsDisabled: busy,
									visibilityToggling: togglingModels,
									onVisibilityToggle: (modelId, visible) => {
										control({
											action: "set-model-visibility",
											model: modelId,
											visible,
											account: status.visibility?.account ?? ""
										});
									}
								})
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: tabPanelStyle,
								children: [status.credits === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: quotaListStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										style: quotaTitleStyle,
										children: t("creditsDetailHeading")
									}), status.credits.accounts.filter((account) => account.packageName === "enterprise" || account.remain > 0 || account.unlimited === true).map((account, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreditBar, {
										label: account.packageName === "enterprise" ? t("packageEnterprise") : account.packageName,
										remain: account.remain,
										size: account.size,
										unlimited: account.unlimited,
										t
									}, `${account.packageName}-${String(index)}`))]
								}), status.models === void 0 || status.models.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: quotaListStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										style: quotaTitleStyle,
										children: t("modelsHeading")
									}), status.models.filter((model) => model.free === true || (model.badges?.length ?? 0) > 0).map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelOfferRow, {
										model,
										t
									}, model.id))]
								})]
							})
						] }) : null,
						status?.status === "signed-out" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: status.reason === void 0 ? bodyStyle : errorStyle,
							children: status.reason ?? t(variant.signedOutKey)
						}), assistCode === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AssistBlock, {
							t,
							variant,
							failureSummary: status.reason ?? t(assistSummaryKey(assistCode, variant)),
							busy,
							onRecheck: () => {
								manualRefresh();
							}
						})] }) : null,
						status?.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: errorStyle,
							children: status.message
						}) : null
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/WorkBuddyProbeControl.tsx
		/**
		* Per-model credit badge beside the Composer's model selector.
		*
		* The seat shows the signed-in account's remaining WorkBuddy balance as one
		* tiny annotation next to the selected model, read from the plugin's own status
		* route:
		*
		* - a **credit badge** (#99): the remaining balance, set smaller and dimmer than
		*   the surrounding chrome so it reads as an annotation on the icon. Hidden
		*   whenever the document has no honest answer (signed-out, error, missing
		*   `credits`); zero is a real balance and is shown, `unlimited` renders as ∞
		*   rather than as 0.
		* - a **↻ beside the badge** is the only re-read after the mount fetch: there
		*   is no interval and no focus polling, because every status GET also queries
		*   billing upstream and the balance should not refresh behind the user's back.
		*   A failed manual read hides the balance rather than passing the old one off
		*   as current.
		*
		* Reasoning-effort detection used to live in this same seat. It was removed:
		* the plugin now sends one fixed effort for every reasoning model (see
		* `FIXED_REASONING_EFFORT` in `adapter.ts`), so there is nothing left to detect
		* and no per-model entry to render. The module and symbol names keep their
		* historical `probe` spelling because the route path they build on does too.
		*
		* @module dsh-workbuddy-connect/client/probe-control
		*/
		/**
		* The card (and therefore the routes) a selected provider belongs to.
		*
		* The control serves both WorkBuddy providers from one seat, so the provider id
		* is what selects the status and probe endpoints. Returning `undefined` for any
		* other provider is what keeps the icon off every non-WorkBuddy model.
		*/
		function cardVariantFor(provider) {
			return CARD_VARIANTS.find((card) => card.id === provider);
		}
		const wrapperStyle = {
			display: "inline-flex",
			position: "relative",
			alignItems: "center",
			transform: "translateY(2px)",
			marginRight: -8
		};
		/**
		* The inline label. Smaller and dimmer than the surrounding chrome on purpose:
		* it names the feature, so it should read as an annotation attached to the icon
		* rather than compete with the adjacent model selector.
		*/
		/**
		* The credit badge (#99). The same annotation register as {@link labelStyle} —
		* small and dim, on the model name's side of the seat — so a changing balance
		* reads as a note on the selection, not composer chrome of its own.
		*/
		const creditStyle = {
			fontSize: 11,
			lineHeight: "16px",
			color: "var(--dsw-alias-label-tertiary)",
			whiteSpace: "nowrap",
			padding: "0 4px"
		};
		/**
		* The badge's ↻ (#99): the only re-read after the mount fetch. An icon-only
		* button in the same dim register, so it reads as part of the annotation
		* rather than a fourth composer control.
		*/
		const refreshStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 20,
			height: 20,
			padding: 0,
			border: 0,
			borderRadius: 6,
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary)"
		};
		/** Tooltip bubble: the Fast Mode shape (nowrap, one line, above the control). */
		/** Confirmation bubble: same anchor, but interactive and allowed to wrap. */
		/**
		* Primary action inside the confirmation bubble.
		*
		* The fill and its text colour must come as a pair: `brand-primary` resolves to
		* a light accent in this theme, so hardcoding `color: #fff` on top of it renders
		* white-on-white. `button-primary-fill` + `label-primary-foreground` is the
		* theme's own pair for exactly this, and is what `dsh-codex-connect` uses for
		* the same job.
		*/
		/**
		* Result note: a single line + a dismiss button, anchored to the control's
		* right side. Smaller than the confirmation bubble because it carries an
		* *outcome*, not a *decision* — the work is done, the user only has to read
		* and dismiss.
		*/
		/**
		* The note's dismiss action. Outlined rather than bare text: inside an already
		* bordered bubble, an unbordered word does not read as something you can click.
		* Matches the outlined pill convention the plugin's other secondary actions use.
		*/
		/**
		* The credit badge's one line, or `undefined` whenever there is no honest
		* answer to show (#99).
		*
		* Every non-answer collapses to hidden: a signed-out or errored document, a
		* missing `credits` section (which is also all a `creditsError` leaves behind),
		* or a total that is not a finite number — the status guard deliberately does
		* not validate optional fields, so this narrows before reading. Zero is a real
		* balance and is shown; `unlimited` renders as ∞, never as 0.
		*/
		function creditBadge(status, card, t) {
			if (status === void 0 || status.status !== "signed-in") return void 0;
			if (status.creditsError !== void 0) return void 0;
			const credits = status.credits;
			if (credits === void 0) return void 0;
			const total = credits.unlimited === true ? "∞" : typeof credits.total === "number" && Number.isFinite(credits.total) ? new Intl.NumberFormat(void 0, { maximumFractionDigits: 2 }).format(credits.total) : void 0;
			if (total === void 0) return void 0;
			return t("composerCredit", {
				prefix: card.creditPrefix,
				total
			});
		}
		/** Model-independent shell: resolves the selection, then delegates per model. */
		function WorkBuddyProbeControl({ directory, t }) {
			const subscribe = (0, react.useCallback)((listener) => directory.subscribe(listener), [directory]);
			const snapshot = (0, react.useCallback)(() => directory.getSnapshot(), [directory]);
			const selection = (0, react.useSyncExternalStore)(subscribe, snapshot, snapshot).current;
			if (selection == null) return null;
			const card = cardVariantFor(selection.provider);
			return card === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelProbe, {
				model: selection.model,
				card,
				t
			}, `${card.id}:${selection.model}`);
		}
		function ModelProbe({ model, card, t }) {
			const [status, setStatus] = (0, react.useState)();
			/**
			* A manual credit read failed (#99). The balance hides until a later read
			* succeeds, so the old number can never pose as current; the probe state is
			* untouched — the two features merely share one document.
			*/
			const [creditFailed, setCreditFailed] = (0, react.useState)(false);
			/** Whether a manual credit refresh is in flight, for the ↻'s busy state. */
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			(0, react.useRef)(false);
			const refreshingRef = (0, react.useRef)(false);
			const mounted = (0, react.useRef)(false);
			const readSeq = (0, react.useRef)(0);
			const refresh = (0, react.useCallback)(async (signal) => {
				const seq = ++readSeq.current;
				const response = await fetch(card.statusPath, {
					credentials: "same-origin",
					cache: "no-store",
					headers: { accept: "application/json" },
					...signal === void 0 ? {} : { signal }
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const value = await response.json().catch(() => void 0);
				if (!isWorkBuddyWebStatus(value)) throw new Error(t("statusResponseInvalid"));
				if (mounted.current && !signal?.aborted && seq === readSeq.current) {
					setStatus(value);
					setCreditFailed(false);
				}
			}, [card.statusPath, t]);
			(0, react.useEffect)(() => {
				mounted.current = true;
				const controller = new AbortController();
				refresh(controller.signal).catch(() => {});
				return () => {
					mounted.current = false;
					controller.abort();
				};
			}, [refresh]);
			/**
			* The ↻'s action (#99): one manual re-read through the same status route.
			*
			* The guard is a ref, not the state: two clicks inside one act batch both
			* see the same stale `refreshing` closure, and only a synchronous check can
			* keep the second click from sending a second billing read.
			*
			* A failure hides the balance (see `creditFailed`) instead of leaving the old
			* number on screen as though it were fresh — but only when the failed read is
			* still the newest one (`refresh` bumped `readSeq` for it, and nothing newer
			* has started since). An out-of-date manual failure racing a successful
			* probe's trailing read must not hide the fresh balance that just arrived:
			* `readSeq` is what decides, and `refresh` itself already clears the flag on
			* any newer successful write.
			*/
			const checkNow = async () => {
				if (refreshingRef.current) return;
				refreshingRef.current = true;
				setRefreshing(true);
				const seqAtStart = readSeq.current + 1;
				try {
					await refresh();
				} catch {
					if (mounted.current && readSeq.current === seqAtStart) setCreditFailed(true);
				} finally {
					refreshingRef.current = false;
					if (mounted.current) setRefreshing(false);
				}
			};
			const credit = creditFailed ? void 0 : creditBadge(status, card, t);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: wrapperStyle,
				children: [credit === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: creditStyle,
					children: credit
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: {
						...refreshStyle,
						opacity: refreshing ? .6 : 1,
						cursor: refreshing ? "default" : "pointer"
					},
					title: t("composerCreditRefresh"),
					"aria-label": t("composerCreditRefresh"),
					"aria-busy": refreshing,
					disabled: refreshing,
					onClick: () => {
						checkNow();
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
						width: "12",
						height: "12",
						viewBox: "0 0 24 24",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "2",
						strokeLinecap: "round",
						strokeLinejoin: "round",
						"aria-hidden": "true",
						focusable: "false",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M20 12a8 8 0 1 1-2.34-5.66" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M20 4v4h-4" })]
					})
				})]
			});
		}
		//#endregion
		//#region src/client/WorkBuddyConfigPage.tsx
		/**
		* The cards' list; the page supplies no other chrome. A semantic `<ul>` —
		* each card below is an `<li>` — with the user-agent list defaults cleared so
		* only the column/gap rhythm remains, keeping the layout identical to the
		* flex column it replaced while giving the page real list semantics.
		*/
		const pageStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 12,
			listStyle: "none",
			margin: 0,
			padding: 0
		};
		/**
		* Render the bundle's configuration: one status card per WorkBuddy variant.
		*
		* Both variants share one page. DSH 0.1.6 replaced the settings section's
		* keyed `settings.plugin.item` slot — dispatched once per served settings
		* namespace, which is why the two variants used to be two cards — with the
		* Plugins page's `plugins.bundle.config`, keyed by the bundle's package name.
		* A bundle therefore carries exactly one configuration entry, so the cards are
		* stacked here instead of being dispatched separately. (The 0.1.5 settings tab
		* and its two dispatched cards still exist on 0.1.5 hosts; this page only
		* mounts where the Plugins page declares its slot.)
		*/
		function WorkBuddyConfigPage({ view, t }) {
			if (view === "summary") return t("intro");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				style: pageStyle,
				children: CARD_VARIANTS.map((variant) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkBuddyPluginCard, {
					t,
					variant
				}, variant.id))
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Plugin-card copy registered under the settings.workbuddy locale namespace. */
		const en = {
			title: "DSH WorkBuddy Connect",
			intro: "Use the models in the WorkBuddy desktop app directly in DSH — zero configuration, ready out of the box.",
			titleAI: "DSH WorkBuddy AI Connect",
			introAI: "Use the models in the WorkBuddy AI international desktop app directly in DSH — zero configuration, ready out of the box.",
			expand: "Expand",
			collapse: "Collapse",
			loading: "Loading account…",
			signedOut: "Not signed in",
			signedOutHint: "Sign in once in the WorkBuddy desktop app; this plugin follows that sign-in automatically.",
			signedOutHintAI: "Sign in once in the WorkBuddy AI desktop app; this plugin follows that sign-in automatically.",
			signedInAs: "Signed in as {nickname}",
			accessTokenExpires: "Access token expires {time} (refresh is automatic)",
			creditsHeading: "Remaining credit",
			tabStatus: "Status",
			tabContext: "Context window",
			tabDetails: "Credit details",
			creditsDetailHeading: "By package",
			creditsTotal: "Total: {total}",
			creditsTotalUnlimited: "Total: Unlimited",
			unlimitedQuota: "Unlimited",
			composerCredit: "{prefix}{total} credits",
			composerCreditRefresh: "Refresh credit balance",
			packageEnterprise: "Enterprise quota",
			cycleResetAt: "Resets {time}",
			expiryWarningSoon: "{total} credit expires within 24 hours ({packages} packages)",
			expiryWarningWeek: "{total} credit expires within 7 days ({packages} packages)",
			expiryExpiresAt: "Earliest: {time}",
			percentRemaining: "{percent}% remaining",
			percentUnknown: "Remaining share unknown",
			exactRemaining: "{remain} / {size} remaining",
			creditPackageUnknownSize: "{remain} remaining",
			creditsError: "Credit unavailable: {message}",
			refresh: "Refresh",
			refreshing: "Refreshing…",
			refreshModels: "Refresh model list",
			refreshingModels: "Refreshing models…",
			catalogLive: "Model list updated {time}",
			catalogSaved: "Showing the saved model list from {time}",
			catalogFallback: "Showing the built-in model list (not yet updated from WorkBuddy)",
			catalogError: "Last update failed: {message}",
			catalogAppVersion: "App version {version}",
			requestFailed: "Request failed",
			statusRefreshFailed: "Refresh failed: {message} — showing the last known state",
			statusResponseInvalid: "WorkBuddy returned an unreadable status reply",
			accountHeading: "Account",
			modelsHeading: "Model offers",
			contextHeading: "Context window",
			contextUpTo: "up to {size}",
			contextDefault: "default {size}",
			contextUnknown: "no declared context window",
			useMaximumContextWindow: "Use the largest declared context window",
			useMaximumContextWindowHint: "Applies to WorkBuddy AI models that offer a larger window.",
			visibilityIntro: "Uncheck a model to hide it from the model picker. Saved per signed-in account; chats already using a hidden model keep working.",
			visibilityStaleAccount: "The signed-in account changed — this change was not saved.",
			freeModel: "Free",
			badgeLimitedFree: "Limited-time free",
			badgeNightDiscount: "Night discount",
			badgeFreeNow: "Free now",
			rate: "{rate} credits per message",
			rateUnknown: "Price unavailable — refresh to update",
			cancel: "Cancel",
			assistantHeading: "Let an Agent sort this out",
			assistantIntro: "Send the request below to your Agent; it will check the app location and the launch configuration for you.",
			assistantCopy: "Copy for Agent",
			assistantCopied: "Copied",
			assistantCopyFailed: "Copy failed — select the text above and copy it manually",
			assistantAfter: "When your Agent is done, come back and check again. If the DSH launch environment was changed, restart DSH first as instructed.",
			assistantRecheck: "Done — check again",
			assistantRechecking: "Checking…",
			assistantPrompt: "DSH's dsh-workbuddy-connect cannot use my {appName}: {failureSummary}. Please check the actual installation location and any existing path configuration, help the plugin use it correctly, and verify recovery. If the DSH launch environment must be changed or DSH restarted, give me clear steps; do not only set an environment variable temporarily in the current shell.",
			assistNotFound: "no usable decryption program was found",
			assistAmbiguous: "more than one WorkBuddy copy was found and none could be chosen safely",
			assistIncomplete: "the automatic search could not be completed",
			assistPathInvalid: "the configured program path is not usable",
			assistUnavailableCN: "no decryption program is configured for this platform",
			assistUnavailableAI: "no decryption program is configured for WorkBuddy AI"
		};
		const zh = {
			title: "DSH WorkBuddy Connect",
			intro: "在 DSH 中直接使用 WorkBuddy 桌面 App 包含的模型，开箱即用，无需额外配置。",
			titleAI: "DSH WorkBuddy AI Connect",
			introAI: "在 DSH 中直接使用 WorkBuddy AI 国际版桌面 App 包含的模型，开箱即用，无需额外配置。",
			expand: "展开",
			collapse: "收起",
			loading: "正在读取账号…",
			signedOut: "未登录",
			signedOutHint: "在 WorkBuddy 桌面 App 里登录一次即可，插件会自动跟随当前登录的账号。",
			signedOutHintAI: "在 WorkBuddy AI 国际版桌面 App 里登录一次即可，插件会自动跟随当前登录的账号。",
			signedInAs: "已登录：{nickname}",
			accessTokenExpires: "访问令牌 {time} 过期（自动续期）",
			creditsHeading: "剩余积分",
			tabStatus: "状态",
			tabContext: "上下文窗口",
			tabDetails: "积分详情",
			creditsDetailHeading: "按套餐",
			creditsTotal: "合计：{total}",
			creditsTotalUnlimited: "合计：不限额",
			unlimitedQuota: "不限额",
			composerCredit: "{prefix}{total}（积分）",
			composerCreditRefresh: "刷新积分",
			packageEnterprise: "企业额度",
			cycleResetAt: "重置时间：{time}",
			expiryWarningSoon: "有 {total} 积分将在 24 小时内过期（{packages} 个套餐）",
			expiryWarningWeek: "有 {total} 积分将在 7 天内过期（{packages} 个套餐）",
			expiryExpiresAt: "最早到期：{time}",
			percentRemaining: "剩余 {percent}%",
			percentUnknown: "剩余占比未知",
			exactRemaining: "剩余 {remain} / {size}",
			creditPackageUnknownSize: "剩余 {remain}",
			creditsError: "积分查询失败：{message}",
			refresh: "刷新",
			refreshing: "正在刷新…",
			refreshModels: "刷新模型列表",
			refreshingModels: "正在刷新模型…",
			catalogLive: "模型列表更新于 {time}",
			catalogSaved: "当前显示已保存的模型列表，更新于 {time}",
			catalogFallback: "当前显示内置模型列表（尚未从 WorkBuddy 更新）",
			catalogError: "上次更新失败：{message}",
			catalogAppVersion: "App 版本 {version}",
			requestFailed: "请求失败",
			statusRefreshFailed: "刷新失败：{message} — 当前显示的是上次成功获取的状态",
			statusResponseInvalid: "WorkBuddy 返回的状态数据无法识别",
			accountHeading: "账号",
			modelsHeading: "模型优惠",
			contextHeading: "上下文窗口",
			contextUpTo: "最高 {size}",
			contextDefault: "默认 {size}",
			contextUnknown: "未声明上下文窗口",
			useMaximumContextWindow: "使用上游声明的最大上下文窗口",
			useMaximumContextWindowHint: "仅作用于 WorkBuddy AI 中声明了更大窗口的模型。",
			visibilityIntro: "取消勾选即可在模型选择器中隐藏该模型；按当前登录账号分别保存，已在用该模型的会话不受影响。",
			visibilityStaleAccount: "登录账号已切换——本次修改未保存。",
			freeModel: "免费",
			badgeLimitedFree: "限时免费",
			badgeNightDiscount: "夜间折扣",
			badgeFreeNow: "限时免费",
			rate: "{rate} 积分/次",
			rateUnknown: "价格未知 — 刷新后更新",
			cancel: "取消",
			assistantHeading: "让 Agent 帮你处理",
			assistantIntro: "把下面这段请求发给你的 Agent，它会协助检查应用位置和启动配置。",
			assistantCopy: "复制给 Agent",
			assistantCopied: "已复制",
			assistantCopyFailed: "复制失败，请手动选择上方文字复制",
			assistantAfter: "Agent 处理完成后，回到这里重新检查；如果修改了 DSH 的启动环境，请先按指引重启 DSH。",
			assistantRecheck: "已处理，重新检查",
			assistantRechecking: "正在检查…",
			assistantPrompt: "DSH 的 dsh-workbuddy-connect 无法使用我的 {appName}：{failureSummary}。请帮我检查实际安装位置和已有路径配置，让插件能正确使用它，并验证恢复结果；如果需要修改 DSH 的启动环境或重启，请给我明确的操作步骤，不要只在当前 shell 临时设置环境变量。",
			assistNotFound: "没有找到可用的解密程序",
			assistAmbiguous: "找到了多个 WorkBuddy 副本，无法安全自动选择",
			assistIncomplete: "自动定位未能完成",
			assistPathInvalid: "指定的程序路径不可用",
			assistUnavailableCN: "当前平台尚未配置解密程序",
			assistUnavailableAI: "尚未配置 WorkBuddy AI 的解密程序"
		};
		//#endregion
		//#region src/client/index.tsx
		/** Stable browser-plugin name. */
		const name = "dsh-workbuddy-connect-client";
		/**
		* The bundle's package name, which is also this half's configuration key.
		*
		* The Plugins page dispatches `plugins.bundle.config` by the bundle's package
		* name, so the key has to spell exactly what the profile installs.
		*/
		const BUNDLE_NAME = "dsh-workbuddy-connect";
		/**
		* Client services required by this browser half.
		*
		* DSH 0.1.2 removed `@deepseek-ai/dsh-client-runtime` (the package that used to
		* hold the browser `ClientContext` alias and the `slots` service), so the
		* services come from narrower packages: the `slots` registry lives in
		* `@deepseek-ai/dsh-client-ui-renderer` and `locale` in
		* `@deepseek-ai/dsh-client-locale`. Neither slot owner is named here on
		* purpose: `settings.plugin.item`'s declarer (`…-ui-settings-plugins`) is
		* absent from 0.1.6+ hosts and `plugins.bundle.config`'s declarer
		* (`…-ui-plugin-manager`) is absent from 0.1.5 hosts, and the seam choice is
		* made by slot-declaration lifetime, not by activation order — `ctx.slots.inject`
		* fires whenever the declaring package commits the slot, before or after this
		* fiber starts.
		*/
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.session"
		];
		/** Prefix every guarded client contribution's degradation logs with this. */
		const CLIENT_CONTRIBUTION_FAILED = "[dsh-workbuddy-connect] client contribution failed to load (host provider unaffected):";
		/** Disposer handed back when a deferred registration degraded: nothing to undo. */
		const NOOP_DISPOSER = () => {};
		/**
		* Run ONE browser-side contribution, degrading its failure to a `console.error`
		* instead of throwing into the DSH loader. Returns the contribution's own
		* value on success, or `undefined` when it degraded — the deferred slot
		* callbacks below substitute `NOOP_DISPOSER` for that, because the slot
		* runtime always expects a disposer back.
		*
		* Every contribution is guarded at BOTH boundaries where it can throw:
		*
		* 1. the eager `ctx.slots.inject(...)` / `ctx.inject(...)` call itself, which
		*    runs synchronously inside `apply()` — e.g. a slot-API shape break such as
		*    the rc.6→rc.7 `id`→`key` rename;
		* 2. the deferred callback, which the slot runtime invokes later — when the
		*    owner commits the slot's declaration, or when the injected services
		*    arrive — long after `apply()` has returned, where no enclosing try/catch
		*    could still catch it.
		*
		* The pair is what makes the contributions independent: a failure in one
		* settings seam, or in the probe control, leaves every other registration
		* intact. Guards are for THIS browser half only; the host half reports its own
		* errors through `ctx.logger`.
		*/
		function guardClientContribution(label, fn) {
			try {
				return fn();
			} catch (error) {
				console.error(`${CLIENT_CONTRIBUTION_FAILED} ${label}`, error);
				return;
			}
		}
		/**
		* Register the card copy and both settings-surface seams, one guarded
		* contribution at a time.
		*
		* A DSH slot-API breaking change degrades to a `console.error` per
		* contribution instead of throwing into the DSH loader and raising the red
		* "Failed to load plugins" banner; because each contribution carries its own
		* guard, one failing registration never takes the others with it (the old
		* settings cards survive a broken Plugins-page seam, and the probe control
		* survives either). The host provider keeps working throughout: the
		* `workbuddy` model channel is unaffected, and `dsh-workbuddy-connect status`
		* reports host health via the heartbeat file.
		*
		* The tests import this function directly (`tests/client-fallback.spec.ts`),
		* so its isolation semantics are pinned against the real entry — keep any
		* change to the guarded structure in sync with that spec.
		*/
		function apply(ctx) {
			const namespace = "settings.workbuddy";
			guardClientContribution("settings copy", () => {
				ctx.effect(() => ctx.locale.register(namespace, {
					zh,
					en
				}), "dsh-workbuddy-connect: settings copy");
			});
			const t = ctx.locale.bind(namespace);
			for (const [index, variant] of CARD_VARIANTS.entries()) {
				const label = `settings.plugin.item card "${variant.id}"`;
				guardClientContribution(label, () => {
					ctx.slots.inject("settings.plugin.item", () => guardClientContribution(label, () => ctx.slots.register({
						name: "settings.plugin.item",
						key: variant.id,
						priority: 30 - index,
						inject: () => ({
							t,
							variant
						})
					}, WorkBuddyPluginCard)) ?? NOOP_DISPOSER);
				});
			}
			guardClientContribution("plugins.bundle.config page", () => {
				ctx.slots.inject("plugins.bundle.config", () => guardClientContribution("plugins.bundle.config page", () => ctx.slots.register({
					name: "plugins.bundle.config",
					key: "dsh-workbuddy-connect",
					locale: namespace
				}, WorkBuddyConfigPage)) ?? NOOP_DISPOSER);
			});
			guardClientContribution("conversation probe control", () => {
				ctx.inject(["modelDirectories"], (scope) => {
					guardClientContribution("conversation probe control", () => {
						scope.slots.inject("conversation.input.right", () => guardClientContribution("conversation probe control", () => scope.slots.register({
							name: "conversation.input.right",
							id: "workbuddy-probe",
							order: 10,
							inject: (sessionId) => ({
								directory: scope.modelDirectories.directoryFor(sessionId).store,
								t
							})
						}, WorkBuddyProbeControl)) ?? NOOP_DISPOSER);
					});
				});
			});
		}
		//#endregion
		exports.BUNDLE_NAME = BUNDLE_NAME;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

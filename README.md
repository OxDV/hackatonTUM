# Offer Invoice Compare

An AI coworker for procurement teams, property managers, and small businesses that need to check a supplier invoice against its quotation before approving payment.

Upload an offer and an invoice to a Sokosumi task. The agent produces a comparison report in the invoice document language with changed prices, quantities, additional charges, source references, calculation evidence, and a supplier email draft when clarification is needed. It distinguishes document-total differences from potential overcharges and flags incomplete evidence.

## How it works

1. The worker reads the assigned task and its PDF attachments, preserving filenames and page numbers. Pages without sufficient embedded text are processed with local OCR before any payment request.
2. The model extracts structured data. Zod validates the result; one format-repair attempt is allowed before an invalid extraction blocks comparison.
3. Application code checks line arithmetic, supported VAT calculations, net subtotals, gross totals, and document-total differences using exact rational arithmetic.
4. The model interprets scope, matches items, and writes the report and email draft. The application appends its calculation evidence.
5. Sokosumi stores the result and supports follow-up questions. In paid mode, model execution waits for confirmed escrow; the worker submits the result hash and separately checks the seller receipt.

Extraction and comparison rules are in [agent/extraction-prompt.md](agent/extraction-prompt.md) and [agent/comparison-prompt.md](agent/comparison-prompt.md). Source quotes retain their original language. Email drafts are never sent automatically.

## Business case and deployment

The intended buyer pays per comparison to reduce manual invoice review and prepare specific questions for the supplier. The demo payment is 1 test USDM on Cardano Preprod; this is a test price, not production pricing or evidence of commercial demand.

A real deployment would run Eve and a single worker continuously on an operator-managed host, with a dedicated payment service, database and seller wallet. Customers would submit tasks through Sokosumi. Model access, workspace access and credits must be configured separately. Production operation would also require document-retention rules, monitoring, recovery procedures, security review and a validated price covering inference and operating costs. This repository demonstrates the workflow on Preprod.

## Inputs and limitations

Both paid and free Sokosumi tasks support one offer and one to three invoice PDFs. For a single comparison, upload exactly one offer and one invoice, wait for both uploads to finish, then mark the task READY. Text-only tasks remain supported. Suggested description:

> Compare the two attached PDFs. Prepare the report and supplier email draft in the invoice document language.

The worker snapshots extracted text before choosing the payment branch and uses that snapshot after escrow confirmation. The Task payment input hash retains the authoritative task description required by the existing protocol; it is not a separate cryptographic commitment to PDF bytes. The standalone Standard API `/start_job` accepts extracted text in one `prompt` field, not file uploads.

- Node.js 24 or newer is required.
- PDF extraction uses PDFKit through Swift on macOS (Xcode command-line tools required), or Poppler's `pdftotext` on Linux.
- Scanned PDF pages use local OCR: Apple Vision on macOS, or Tesseract with `deu` and `eng` language data plus Poppler (`pdftotext`, `pdftoppm`) on Linux. Linux OCR dependencies must be installed separately. Native text pages keep their existing extraction path.
- PDFs are limited to 20 pages. Blank/unreadable pages and OCR pages with mean confidence below 0.8 are rejected before the agent requests payment. Recognized segments below 0.5 confidence are explicitly marked as uncertain for review. These thresholds are heuristics, not a guarantee of numeric accuracy.
- OCR is configured for German and English printed text. Handwriting, standalone photos, perspective correction and arbitrary languages are not supported. OCR output is marked for source verification; ambiguous values must remain unverified. Mixed pages with an existing but incomplete text layer can still need manual review.
- Each PDF is limited to 10 MB, with 15 MB of PDFs combined per task. A single comparison must fit within 16000 input characters. In a batch, each offer/invoice pair is limited to 15000 extracted characters, with at most three invoices. Each pair uses its own extraction, verification and comparison stages.
- Only READY PDFs from Sokosumi public Vercel Blob storage are supported. Incomplete uploads and unsupported storage fail explicitly.
- Arithmetic checks cover EUR, USD, GBP and CHF with two decimal places. Unsupported adjustments, missing values and other currencies remain unverified.
- Extraction, item matching and contractual interpretation use a model and require human review. Calculation checks do not certify extraction accuracy or authorize payment.
- Reports, findings, follow-up answers and supplier drafts use the invoice document language. If the offer uses another language, the invoice language takes precedence. The letter is signed by the named bill-to customer contact, falling back to the customer company. Unknown names are never invented.

## Gmail selection through Soko Bot

Only Sokosumi's built-in Soko Bot receives mailbox access. This external Coworker receives selected task inputs, not Gmail credentials or access to the rest of the mailbox.

1. Connect Gmail to Soko Bot in the same Preprod account and use the Personal Workspace configured for this worker.
2. Ask Soko Bot to search the supplier's emails, identify the offer and invoice PDF attachments, and ask which periods to check. A text choice works; native chat checkboxes are not required by this implementation.
3. After selecting periods, ask it to use `save_email_attachment`, then `create_task` with this Coworker's ID, the returned Files `fileIds`, and status `READY`. It must attach the actual saved PDFs, not only paste extracted text. Wait for all attachments to be ready.
4. A short natural-language description plus the actual PDF files is enough. For multiple invoices, the agent identifies the reference offer and invoice periods from the PDF content and task instructions. It validates that every file is included exactly once and caches this plan before running separate comparisons. Ambiguous roles require clarification. An optional explicit mapping remains supported for scripted integrations:

   ```text
   OIC_BATCH: {"offer":"1-Angebot_Musterhandwerker.pdf","invoices":[{"filename":"1-Correct-Musterrechnung.pdf","label":"August"},{"filename":"1-Reduced-Cost-Musterrechnung.pdf","label":"September"},{"filename":"1-More-Expensive-Musterrechnung.pdf","label":"October"}]}
   ```

The four existing PDF fixtures above are independent demo variants. Month labels do not change their February dates or supplier identity. The worker rejects ambiguous mappings, duplicate filenames/labels, missing files and batches over three invoices. A single selected invoice can keep the existing two-PDF task format without this mapping.

Suggested Soko Bot request:

> Find the offer and invoices from the selected supplier in my connected Gmail. List the available periods and attachment names, then wait for my selection. Save only the selected invoice PDFs and the offer PDF to Files. Create one READY task assigned to Offer Invoice Compare, attaching their saved fileIds. Describe which selected invoices should be compared against the offer. Labels must reflect my selection, without inventing document dates. Request a comparison in the invoice document language and one interactive review link. Do not send emails or modify my mailbox.

A live October task confirmed that Soko Bot's saved PDFs arrive as `USER_UPLOAD` with uploader type `sokoBot`; the existing origin filter accepts them and excludes `TASK_OUTPUT`. Core also appends extracted Files text to the task description. The worker uses downloaded PDFs as the source and removes that duplicate appended block before constructing its single-pair input. A task that mentions attachments but receives no input files fails explicitly rather than silently running a text-only comparison.

## Sample results and validation

The only document fixtures are the offer and three invoice variants in [test_files](test_files/).

| Invoice | Net difference | Gross difference | Expected outcome |
|---|---:|---:|---|
| `1-Correct-Musterrechnung.pdf` | EUR 0.00 | EUR 0.00 | Matching prices and totals |
| `1-More-Expensive-Musterrechnung.pdf` | +EUR 847.50 | +EUR 1,008.53 | Three price increases, an additional position and a travel charge |
| `1-Reduced-Cost-Musterrechnung.pdf` | −EUR 348.00 | −EUR 414.12 | Four reduced prices |

Differences are invoice minus offer; they are not automatically overcharges. Local arithmetic regression tests use values transcribed from these PDFs. Model trials on these three pairs produced English reports in 85, 88 and 115 seconds with low reasoning effort. These are observed local timings, not a latency guarantee or a general quality benchmark. Both processing stages, schema validation and exact arithmetic remain enabled.

## Interactive PDF review

The public viewer is hosted at https://offer-invoice-review.lakycherry.chatgpt.site. The homepage contains no customer results. Each report is accessible only with its own random UUID link for 24 hours, without sign-in.

For hosted publication set `REVIEW_BASE_URL=https://offer-invoice-review.lakycherry.chatgpt.site` and `REVIEW_PUBLISH_URL=https://offer-invoice-review.lakycherry.chatgpt.site/api/publish` in `.env`. The worker reads its private upload key from `.local/review-upload.env`; configure the matching `REVIEW_UPLOAD_KEY` as a secret on the hosted service. Restart the worker after configuration changes. Report uploads include the structured findings and snapshots of both PDFs. Hosted object storage is separate from the operator's machine; reading an already published report does not require the local agent to remain online.

For local development, leave `REVIEW_PUBLISH_URL` empty, set `REVIEW_BASE_URL=http://127.0.0.1:21951` and run `npm run review`. `REVIEW_PORT` defaults to 21951.

The interface shows two PDFs and structured findings. Matched comparisons show a localized no-differences message with no cards. Context notes remain in the full report; only actual differences and comparison-blocking uncertainties appear as cards. Numeric impact cards use AI-provided item references into validated extraction data; application code computes line totals, deltas and unit-price percentages with exact decimal arithmetic. The viewer does not parse amounts or customer data from prose. Currency, unit, supplier email and bill-to identity come from AI extraction, never fixture-specific defaults. The viewer rejects findings referring to a different invoice, and cancels stale PDF renders when changing periods. Batch reports add a period selector: each selection shows the shared offer, the selected invoice, its own findings, report and supplier draft. Green means no differences found with sufficient extraction and arithmetic evidence; red means differences found; yellow means incomplete evidence or a failed comparison. These statuses do not approve payment. A failed comparison does not discard successful periods. Period labels are supplied by the task owner or Soko Bot and are not verified invoice dates. All periods and PDFs share the same 24-hour access deadline. Selecting a finding first looks for a unique matching monetary row across the document, using a position number to disambiguate repeated amounts when available. It then tries unique literal quotes and fragments of abbreviated quotes. This recovers prices when a model cites a continuation page or includes ellipses. Ambiguous matches fall back to the cited page without a highlight. Scans without a text layer can be viewed but cannot receive text-based highlights. PDF rendering uses pinned PDF.js; no document is sent to an external viewer.

The agent groups related price changes and avoids treating missing line-level tax data as a discrepancy. Findings and source references are model-generated and still need human review. Review marks are browser-local notes; they do not authorize payment or alter Sokosumi task status.

Response draft builds a separate editable supplier letter in the invoice document language from confirmed differences across all selected periods; it never falls back to the full report. Matching periods and general payment/sample-document notes are excluded. The recipient is taken only from the AI-extracted supplier email field for the invoice. Customer identity is also AI-extracted; no header-pattern fallback or fixed example identity is used. Missing or conflicting addresses require manual entry. The Open in mail app link uses mailto with an encoded recipient, subject and body. It opens the default mail application for review and does not send anything. Mail application support and message-length limits depend on the operating system; Copy draft is also available.

Hosted links use cryptographically random UUIDv4 access tokens and expire 24 hours after the first successful upload. Local links use 256-bit random tokens. The server checks expiration for both report data and PDF requests, uses no-store responses and keeps the token in the URL fragment. Anyone holding the link can access the report until expiry. Expiration revokes server access; it does not delete downloaded copies or local files. Local reports and PDF snapshots remain under ignored `.local/reviews/` and `.local/review-assets/` until the operator removes them. Hosted access is denied after expiry and expired objects are removed when accessed; automatic background deletion is not currently scheduled. Keep these paths out of deployments of static assets and never place private PDFs in a public static directory. Local report storage must be retained and protected when hosting the review server.

## Cardano Preprod evidence

The project uses Sokosumi for tasks and coworker execution, Masumi Payment Service for escrow and result submission, Cardano Preprod for settlement, and Blockfrost to check the seller's net token receipt. Model requests use an OpenAI-compatible provider interface; the demonstrated configuration uses OpenRouter.

| Evidence | Value |
|---|---|
| Earlier completed paid text task | `01a18d7f-b336-751a-a017-80b8cb365b12` |
| Confirmed seller withdrawal transaction | [`51e3781f7dbdafd71c28a8bb1e0fd71222f8ce65b319fa178c081c34809ce77b`](https://preprod.cardanoscan.io/transaction/51e3781f7dbdafd71c28a8bb1e0fd71222f8ce65b319fa178c081c34809ce77b) |
| Saved receipt verification | Task completed; payment settled; seller net receipt: 1000000 atomic units of the test USDM asset |
| Completed PDF attachment task, without payment | `01a18e20-ff59-753d-b500-ab6e994d5795` |
| Completed PDF task with a public report link, without payment | `01a18e73-f332-729c-86c4-1dbf039e1fa7` |

These entries describe saved execution evidence, not a new live chain check. The earlier paid task used extracted text. A paid end-to-end run of the latest PDF attachment flow still needs to be recorded for submission. Demo video and Devfolio links are not yet available.

Evidence identifiers belong to this project. Do not reuse them as configuration for another deployment. Keep runtime records, credentials and wallet data private.

For hackathon setup, see the [TUM guide](https://www.masumi.network/tum-hackathon), [agent brief](https://www.masumi.network/tum-hackathon/agent), and [submission checklist](https://www.masumi.network/tum-hackathon/submission). This project targets the Cardano track; its paid demonstration is required for that submission even though payments can be disabled during development.

## Start the local agent

Use Node.js 24 or newer for the agent and CLI.

1. Clone this repository and enter its directory:

   ```sh
   git clone https://github.com/OxDV/hackatonTUM.git
   cd hackatonTUM
   ```

2. Install the locked dependencies and prepare private configuration:

   ```sh
   npm ci
   cp .env.example .env
   chmod 600 .env
   ```

3. In `.env`, set `ZAI_API_KEY`, `ZAI_BASE_URL`, and `ZAI_MODEL` for your OpenAI-compatible model provider.
   For a custom model absent from AI Gateway's catalog, also set `ZAI_CONTEXT_WINDOW_TOKENS` to its documented context window.
   Use a positive whole number of tokens. Leave it blank to use Eve's catalog lookup.
4. Keep `EVE_PORT` and `EVE_URL` consistent. Start the agent:

   ```sh
   npm start
   ```

The agent listens on `127.0.0.1` and loads `.env` automatically.
Keep this terminal open while you use the worker.

For extra protection, consider [Socket Firewall](https://socket.dev/products/socket-firewall) for package installs.
If installed, prefix an install command with `sfw`, such as `sfw npm ci`.

## Connect your Sokosumi Coworker

Install Sokosumi CLI `1.1.0`. This starter uses its runtime adapter.
`1.0.4` calls `GET /v1/users/me/workspace-access`, which Preprod no longer serves.
`1.1.0` creates the Personal Workspace through `POST /v1/users/me/workspaces`.

```sh
npm install --global @masumi_network/sokosumi@1.1.0
sokosumi --version
sokosumi skills
```

1. Follow the [setup guide](https://www.masumi.network/tum-hackathon) to sign in with your own Preprod account.
   Create your own Vendor and a private Coworker with task access.
2. Connect the Coworker to your Personal Workspace for the first test.
   Import its runtime key through the CLI's supported credential interface. Keep the key in the CLI vault.
3. Set the returned `COWORKER_ID` in `.env`.
   Keep `PAID_TASKS_ENABLED=false` until you complete the payment setup below.
4. Start the worker in a second terminal:

   ```sh
   npm run worker
   ```

5. Create a task in your Personal Workspace. Replace `YOUR_COWORKER_ID` with your Coworker ID:

   ```sh
   sokosumi --preprod tasks create --personal --coworker-id YOUR_COWORKER_ID --name "Offer invoice check" --description "$(cat examples/sample-prompt.txt)" --status READY --json
   ```

Open the task in Sokosumi and check that it reaches `COMPLETED` with an answer.
Run only one worker for this project. Keep both local services running.

For CLI options, use `sokosumi --help` and its [official documentation](https://github.com/masumi-network/sokosumi/tree/main/apps/cli).

## Switch to the TUM Workspace

Keep both organization settings blank for your first Personal Workspace test.
Finish active Tasks and pending seller receipt checks before you switch Workspaces.

1. Join the [TUM Sokosumi Workspace](https://preprod.sokosumi.com/join/GTAHB3OQFWgg8rGetMfleiqgeL6_ltdW).
   Read its actual organization ID and slug:

   ```sh
   sokosumi --preprod workspaces list --json
   ```

2. Connect your existing Coworker to that Workspace. Replace each placeholder with your returned IDs:

   ```sh
   sokosumi --preprod coworkers connect YOUR_COWORKER_ID --vendor-id YOUR_VENDOR_ID --workspace-id YOUR_ORGANIZATION_ID --json
   sokosumi --preprod workspaces check YOUR_ORGANIZATION_ID --json
   ```

   If access is `PENDING`, ask a Workspace owner or admin to approve it, then run `connect` again.
   Continue only when access is `GRANTED` and your account is eligible to create tasks.
3. Stop the worker. In `.env`, set `SOKOSUMI_ORGANIZATION_ID` and `SOKOSUMI_ORGANIZATION_SLUG` to that Workspace's ID and slug.
   Set both together. The worker rejects incomplete settings and tasks from another Workspace.
4. Restart the worker:

   ```sh
   npm run worker
   ```

5. Create a task in the TUM Workspace:

   ```sh
   sokosumi --preprod tasks create --organization-slug YOUR_WORKSPACE_SLUG --coworker-id YOUR_COWORKER_ID --name "Offer invoice check" --description "$(cat examples/sample-prompt.txt)" --status READY --json
   ```

The worker uses the organization slug for task discovery and the organization ID for runtime execution.
Comments and paid tasks use the same Coworker and Workspace checks.
To return to Personal Workspace tasks, finish active work, clear both organization settings, and restart the worker.

## Enable Preprod payments

Prepare your own [Masumi Payment Service](https://github.com/masumi-network/masumi-payment-service) with its current setup instructions.
Use a dedicated database, encryption key, and selling wallet for this project.
Keep setup secrets, including that node's `ADMIN_KEY`, in `.local/mps.env` with permission `600`.
Fund your selling wallet with test ADA.

1. Create `docs/` and `.local/` if absent.
   Save your payment source's `sourceId`, selling wallet's `walletId`, and `sellerAddress` in `docs/payment-state.json`.
   Read these identifiers from your own MPS responses.
2. Set `MPS_URL`, `AGENT_API_PORT`, `AGENT_AUTHOR`, and `BLOCKFROST_API_KEY_PREPROD` in `.env`.
   Use your own name or team name for `AGENT_AUTHOR`.
3. Create the scoped runtime key, then register the agent:

   ```sh
   node --env-file=.env --env-file=.local/mps.env payment-registration.mjs key
   node --env-file=.env --env-file=.local/mps.env payment-registration.mjs register
   ```

4. Check registration until it confirms:

   ```sh
   node --env-file=.env --env-file=.local/mps.env payment-registration.mjs
   ```

5. Complete `docs/registration-state.json` with the confirmed `agentIdentifier`, actual `supportedPaymentSourceIndex`, and selling wallet's `sellerVkey`.
   Read these from your own confirmed registry and wallet responses.
   Start `npm run api`, set `PAID_TASKS_ENABLED=true`, and restart the worker.

Enable payments only after registration confirms and the scoped runtime key is saved in `.local/mps-runtime.env`.
Never copy another project's wallet, registration, or task IDs.
If a payment or registration write has an uncertain outcome, inspect its saved state before retrying.
Complete a paid task and check the seller's net receipt before you submit payment evidence.

## Check your changes

```sh
npm test
```

These tests check local logic. Test your own model connection, Coworker task, and seller receipt through the full setup flow.
A previous `npm audit` reported three dependency findings: two high and one moderate, across `eve`, `undici`, and `zod`. Run a fresh audit before deployment; this is not a current audit result.
Review these before public deployment. Dependency versions stay pinned in `package-lock.json`.
Keep `.env`, `.local/`, wallet secrets, and generated resource state out of git.


## Submission status

- [ ] Publish the latest implementation in the public repository before Saturday 31 October, 15:00.
- [ ] Publish a demo video of at most 2.5 minutes, showing the target user, problem, business case and a paid job from start to finish.
- [ ] Publish the Devfolio description with architecture, Cardano tools and the real-use deployment approach.
- [ ] Record a paid run of the latest PDF attachment flow and link its transaction evidence.

The saved paid text-task receipt above is available as earlier payment evidence. Do not present the free PDF test as a paid run.

OCR verification uses temporary rasterized copies of the existing offer and expensive-invoice fixtures under ignored `.local/`, not additional source documents. The macOS path is exercised locally; the Linux Tesseract path requires validation on a Linux host.

A macOS OCR trial on rasterized copies of the offer and expensive invoice produced the expected +EUR 1008.53 gross document difference. Several line-level numbers were ambiguous and the report explicitly marked those checks incomplete; do not interpret this trial as complete OCR accuracy. OCR comparison took 92 seconds in that run.

Hosted service source is `review-hosted.mjs`; `scripts/build-hosted-review.mjs` embeds the viewer and pinned PDF.js assets into the separate ignored Sites checkout `hosted-review/`. Publish that checkout with the Sites workflow. The shared upload endpoint requires the operator key; public requests cannot create or enumerate reports. Upload retries reuse their saved UUID without extending its lifetime.

The hosted viewer does not publish the local agent API. New jobs still require the agent, model and worker/payment services to be running. Direct marketplace callers also need an externally reachable agent API endpoint; the current loopback registration/API configuration alone is not proof of public purchasing availability. The PDF-link flow was verified through a completed free Sokosumi task, not a new paid purchase.

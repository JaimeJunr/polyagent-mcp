// Casos fixos: conclusões rotuladas para medir o risco de pular o arbiter e a escolha de tier.
export const FANOUT_CASES = [
  { id: "review-null-guard", label: "agree", outputs: [
    "Review: approve. The new null guard covers missing metadata before reading `owner.id`; no blocker found.",
    "Verdict: LGTM. I traced the empty-metadata path and the added guard prevents the former TypeError. Tests cover it; I found no blocking issue.",
  ] },
  { id: "review-transaction", label: "agree", outputs: [
    "Request changes: the handler writes the payment before opening the transaction. A later failure leaves an orphan charge.",
    "Blocker in payment flow. The charge insert occurs outside the transaction, so rollback cannot undo it if receipt creation fails. Move it inside before merge.",
  ] },
  { id: "approach-pagination", label: "agree", outputs: [
    "Use cursor pagination keyed by (created_at, id); offset will drift under concurrent inserts.",
    "Recommendation: a compound cursor of timestamp plus stable ID. This preserves ordering when new rows arrive and avoids duplicates that OFFSET can produce.",
  ] },
  { id: "bug-cache", label: "agree", outputs: [
    "Root cause: cache key omits tenantId, causing cross-tenant reuse. Include tenantId and evict old entries.",
    "The stale response is produced by the shared cache. Its key uses only reportId, so tenants collide. Fix the key to include tenant ID; invalidate existing keys.",
  ] },
  { id: "version-zod", label: "agree", outputs: [
    "For the API in this repo, pin zod@3.23.8. The v4 parser semantics are different.",
    "Use version 3.23.8 of Zod for this dependency set. I would not move to major 4 in this patch because the schema behavior changes.",
  ] },
  { id: "review-timeout", label: "agree", outputs: [
    "Approve after the timeout cleanup: the timer is cleared on both resolve and reject.",
    "No blocker. Both completion branches now clear the timeout handle, so the retry loop does not retain timers. Verdict: approve.",
  ] },
  { id: "approach-idempotency", label: "agree", outputs: [
    "Prefer a unique database key on (account_id, request_id) plus conflict handling.",
    "Recommendation is database-enforced idempotency. A unique constraint over account and request IDs handles concurrent requests; catch the uniqueness conflict and return the prior result.",
    "I would choose the unique index and conflict readback rather than an in-memory lock.",
  ] },
  { id: "bug-config", label: "agree", outputs: [
    "Cause is config precedence: the env override is read after defaults are frozen. Read env first.",
    "The environment setting never takes effect because defaults initialize the module before the override is applied. Fix initialization order.",
  ] },
  { id: "version-node", label: "agree", outputs: [
    "Minimum runtime remains Node 18; the code uses fetch but no Node 20-only API.",
    "Node.js 18 is sufficient for this change. The native fetch usage is supported and I did not find a newer runtime dependency.",
  ] },
  { id: "review-index", label: "agree", outputs: [
    "Request changes. The query filters by tenant_id and status but has no supporting index.",
    "This is a performance blocker for the large table: add an index on (tenant_id, status) before merging the new list endpoint.",
  ] },
  { id: "approach-stream", label: "agree", outputs: [
    "Stream the CSV with a cursor; avoid loading all rows into memory.",
    "For export, a database cursor piped to the response is the right approach. Materializing the full result set risks heap exhaustion; stream rows and honor backpressure.",
  ] },
  { id: "bug-utc", label: "agree", outputs: [
    "The date shift comes from parsing a local midnight as UTC. Preserve the supplied timezone.",
    "Diagnosis: timezone conversion at parse time. The input is a local calendar date, yet the handler interprets it as Z time. Use an explicit zone or date-only type.",
  ] },

  { id: "hard-review-auth", label: "disagree", hard: true, outputs: [
    "Review: approve. The endpoint checks `canReadInvoice` before fetching the invoice; tenant scoping is preserved.",
    "Review: request changes. The permission check exists, but `getInvoice(id)` is unscoped and the response returns data from another tenant. Add tenant_id to the lookup.",
  ] },
  { id: "hard-approach-cache", label: "disagree", hard: true, outputs: [
    "Both Redis and local LRU meet the latency target. Recommend Redis because shared invalidation must reach all replicas.",
    "Both Redis and local LRU meet the latency target. Recommend local LRU because the data is immutable for each deployment and shared invalidation adds needless network hops.",
  ] },
  { id: "hard-bug-race", label: "disagree", hard: true, outputs: [
    "The duplicate job is caused by two workers reading the same unlocked row. Use SELECT FOR UPDATE SKIP LOCKED.",
    "The duplicate job is caused by a retry after the ACK is lost; the row lock is working. Make the external side effect idempotent by job ID.",
  ] },
  { id: "hard-version-react", label: "disagree", hard: true, outputs: [
    "Use React 18.3.1 here; the renderer and type packages are pinned to 18.",
    "Use React 19.0.0 here; the renderer and type packages should be upgraded together to 19.",
  ] },
  { id: "hard-review-migration", label: "disagree", hard: true, outputs: [
    "Approve: the migration adds a nullable column and the backfill runs asynchronously, so old writers remain compatible.",
    "Request changes: the nullable column is safe, but the same migration adds a NOT NULL constraint before the async backfill. Old rows will make deployment fail.",
  ] },
  { id: "hard-approach-lock", label: "disagree", hard: true, outputs: [
    "Use optimistic locking with a version column. Conflicts are rare and retries are cheap.",
    "Use a database row lock. Conflicts are common on this hot account and optimistic retries would amplify load.",
  ] },
  { id: "hard-bug-token", label: "disagree", hard: true, outputs: [
    "Root cause is the access token expiring during the long upload; refresh before the final commit.",
    "Root cause is the refresh token being rotated in memory but not persisted; the next upload starts with a revoked token.",
  ] },
  { id: "hard-version-typescript", label: "disagree", hard: true, outputs: [
    "TypeScript 5.6.3 supports this syntax; keep the current compiler.",
    "This syntax needs TypeScript 5.7.2. Upgrade the compiler and lockfile before adopting it.",
  ] },
  { id: "review-sql", label: "disagree", outputs: [
    "Approve. The query uses parameter placeholders for both user inputs; no injection path found.",
    "Block merge. The sort column is interpolated directly from the request, allowing SQL injection despite parameterized WHERE values.",
  ] },
  { id: "approach-queue", label: "disagree", outputs: [
    "Recommend an async queue for image processing; the HTTP request should return a job ID.",
    "Keep image processing synchronous in the request. The workload is under 100 ms and a queue adds unnecessary eventual consistency.",
  ] },
  { id: "bug-encoding", label: "disagree", outputs: [
    "The mojibake originates in the CSV reader using Latin-1 for a UTF-8 file.",
    "The CSV is decoded correctly; the corruption happens when the response writer labels UTF-8 bytes as ISO-8859-1.",
  ] },
  { id: "version-vite", label: "disagree", outputs: [
    "Pin Vite 5.4.10 for the current plugin set.",
    "Pin Vite 6.0.1; the plugins already support 6 and the new API requires it.",
  ] },
];

// Respostas longas preservam o contexto comum; o veredito divergente vem depois do corte de 6.000 caracteres.
function longWalkthrough(facts, order = "execution") {
  const sections = {
    scope: `## Scope and changed files\nI reviewed ${facts.scope}. The relevant path starts at ${facts.entry}, passes through ${facts.middle}, and ends at ${facts.exit}. The patch also touches ${facts.neighbor}; that second file matters because the behavior seen by the caller depends on both sides of the boundary. I read the changed lines in context, then checked the call sites and the older path used before this patch. The important invariant is ${facts.invariant}. A local reading of one changed function is insufficient here: a caller can satisfy its own precondition and still receive a result that violates the invariant after the next layer transforms it. I kept the review focused on that end-to-end path and did not infer behavior from the test name alone.`,
    reproduction: `## Reproduction and trace\nThe smallest representative input is ${facts.input}. In the trace, ${facts.trace}. This is a useful reproducer because it crosses the same boundary as production while avoiding unrelated scheduling and network noise. I followed the value at each handoff rather than treating the final response as proof of where it changed. The trace establishes when the state becomes observable, but it does not by itself settle the final decision: ${facts.ambiguity}. A second run with ${facts.control} acts as a control. That control is important because a failure in both runs would point to the harness or fixture rather than this patch. I also checked the error path, where cleanup and retries often differ from the success path.`,
    code: `## Code path\nThe operative fragment is:\n\n\`\`\`ts\n${facts.code}\n\`\`\`\n\nThe first line receives data in the shape described above. The next operation either establishes or assumes the invariant; the final operation makes the result visible to another component. I inspected the surrounding branch condition and its caller, including the default arguments, because a condition that is correct in isolation can be bypassed by a different caller. ${facts.codeNote} The neighboring module performs ${facts.neighborBehavior}. That makes the ordering between these operations material. Merely seeing a guard or a transaction in the diff is not enough to conclude that every path uses it.`,
    tests: `## Tests and negative controls\nThe focused test exercises ${facts.test}. Its assertion is ${facts.assertion}. I would also run ${facts.negativeTest}, which targets the branch most likely to distinguish the competing interpretations. The existing test output was ${facts.testOutput}; I treated that as evidence about the covered path, not as a general guarantee about callers that the fixture does not construct. I checked setup and teardown because reused database rows, fake clocks, or cached modules can make an isolated test pass for the wrong reason. A useful negative control is to restore the pre-patch branch and confirm that the focused assertion fails, then put the patch back and confirm the expected signal returns. That establishes that the test is sensitive to this change rather than incidental setup.`,
    state: `## State and concurrency\nThe relevant state is ${facts.state}. At the boundary, ${facts.stateBoundary}. The ordering matters under ${facts.concurrent}, especially when two requests observe different versions of the same record. I considered a single request, a retry of that request, and an interleaving with another actor. The single-request trace tells us what the code intends; the retry tells us whether the operation is idempotent; the interleaving tells us whether the chosen ownership rule survives load. ${facts.stateNote} I did not assume that a successful response implies durable state. Conversely, a failed response does not prove that no side effect occurred. Both directions need a readback or an independent event record before the root cause can be pinned down.`,
    boundaries: `## Boundary checks\nI checked the entry validation, the service call, persistence, and the outward response separately. ${facts.boundaryDetail} The most useful observation is ${facts.observation}. It narrows the question to a specific boundary, but there are still two plausible readings of the requirement: ${facts.alternatives}. Those readings lead to different final actions even if the trace and code excerpt are identical. For that reason this analysis records what was measured and defers the recommendation to the final section. I also looked for a route that skips the normal entry point, such as a background job, an internal caller, or a retry callback. Any such route needs the same invariant or a documented reason for having a narrower contract.`,
    impact: `## Impact and blast radius\nThe affected users are ${facts.users}. If the suspect branch is taken, the visible symptom is ${facts.symptom}. The likely frequency depends on ${facts.frequency}; the current fixture cannot estimate that frequency from a single run. I checked whether the failure remains inside one request or can persist in ${facts.persistence}. The answer changes the urgency of the fix and the rollback plan. The adjacent code is relevant because ${facts.adjacent}. This is a review of the behavior the patch creates, not a claim that every deployed record is already affected. Logs should be correlated by ${facts.correlation}, with payload fields redacted, to distinguish one repeated request from several independent failures.`,
    rollout: `## Deployment and recovery\nA safe rollout would first ${facts.rollout}, then watch ${facts.signal}. If the signal worsens, the fallback is ${facts.rollback}. I checked compatibility with old readers and writers because a code-only rollback may leave data produced by the new path. The sequence of deploy, backfill, and constraint changes matters even when each step is individually valid. For this review, the deployment question is tied to the same invariant: ${facts.invariant}. A repair should include a focused test and one operational check that observes the result at the outer boundary. The exact release gate depends on which final interpretation is chosen; both interpretations can use the same telemetry and rollback mechanism.`,
    counter: `## Counter-evidence and open questions\nThe strongest evidence against a simple diagnosis is ${facts.counter}. I checked whether it comes from the same code revision, the same tenant or account scope, and the same retry attempt. If any of those differ, it may describe a neighboring path rather than refute the trace above. The unresolved question is ${facts.question}. A one-line assertion can settle it only if the fixture includes the production boundary; otherwise the review should call out the gap explicitly. I would preserve the raw input, the chosen branch, and a readback of final state in the diagnostic record. That is enough to replay the decision without copying secrets or dumping entire responses into logs.`,
    synthesis: `## Synthesis before decision\nThe evidence is consistent on the mechanics: ${facts.mechanics}. The test coverage is narrower than the complete production path, and the deployment plan should account for retries and mixed versions. The remaining choice is how to interpret ${facts.choice}. The code, trace, and controls above are shared evidence for that choice. I have not treated one green test or one plausible code comment as a substitute for the final verdict. The recommendation below is based on the stated contract and the risk of being wrong, with a concrete next step that a maintainer can verify.`,
  };
  const keys = order === "files"
    ? ["scope", "code", "boundaries", "reproduction", "tests", "state", "impact", "counter", "rollout", "synthesis"]
    : ["reproduction", "state", "scope", "tests", "code", "impact", "boundaries", "rollout", "counter", "synthesis"];
  return keys.map((key) => sections[key]).join("\n\n");
}

const LONG_FACTS = [
  {
    id: "long-review-tenant-invoice", label: "disagree", hard: true,
    scope: "the invoice detail endpoint and its authorization change", entry: "routes/invoices.ts:getInvoice", middle: "services/invoices.ts:loadInvoice", exit: "the JSON serializer", neighbor: "repositories/invoices.ts",
    invariant: "a response contains only an invoice belonging to the authenticated tenant", input: "tenant A requesting an invoice id assigned to tenant B", trace: "the permission helper accepts the action, and the repository lookup then reads by id", ambiguity: "the permission helper might already bind the object id to the tenant, or it might check only the action", control: "a same-tenant invoice id",
    code: "const allowed = await canReadInvoice(actor, id);\nif (!allowed) throw forbidden();\nreturn serialize(await invoices.getById(id));", codeNote: "The repository method name does not reveal whether it applies tenant scoping internally.", neighborBehavior: "an id lookup with an optional scope argument",
    test: "a permitted invoice lookup", assertion: "the returned invoice id matches the requested id", negativeTest: "a foreign tenant id with a valid actor", testOutput: "the permitted lookup passed and the foreign-id case was absent",
    state: "the actor's tenant membership and the invoice tenant_id", stateBoundary: "the object id is carried separately from the actor context", concurrent: "a reassignment or stale membership cache", stateNote: "A cached authorization result needs an object-specific key if object scope is part of the rule.",
    boundaryDetail: "The serializer will return any invoice object it receives; it is not an authorization boundary.", observation: "the database query is the last place where tenant scope can be enforced before serialization", alternatives: "object-aware authorization versus action-only authorization",
    users: "tenants sharing the invoice service", symptom: "a foreign invoice could be returned", frequency: "how ids are exposed and how canReadInvoice is implemented", persistence: "audit logs and client caches", adjacent: "list queries already include tenant_id while the detail path is separate", correlation: "request id and tenant id",
    rollout: "add a foreign-tenant regression fixture", signal: "cross-tenant lookup denials and detail endpoint error rates", rollback: "restore the scoped lookup path", counter: "existing list endpoints are scoped correctly", question: "does canReadInvoice query the exact invoice row with actor tenant scope?", mechanics: "the detail path authorizes and then reads by id", choice: "where object scope is enforced",
    endings: ["## Final verdict\nApprove. In this implementation `canReadInvoice(actor, id)` loads the target row with the actor's tenant_id and rejects a foreign row before the repository call. The later id lookup cannot be reached for the cross-tenant input. Keep the negative test as a regression guard, but this patch does not introduce an authorization bypass.", "## Final verdict\nRequest changes. `canReadInvoice(actor, id)` checks only the `invoice:read` action; it does not bind the id to tenant_id. `getById(id)` is unscoped, so a valid tenant A actor can receive tenant B's invoice. Pass tenant_id into the repository lookup, return 404 on a mismatch, and add the foreign-tenant test before merge."],
  },
  {
    id: "long-review-migration-order", label: "disagree", hard: true,
    scope: "the account status migration and asynchronous backfill", entry: "migrations/042_add_status.sql", middle: "jobs/backfillStatus.ts", exit: "account readers", neighbor: "services/accounts.ts",
    invariant: "old and new writers can run while historical rows remain readable", input: "a database with old accounts whose status is null", trace: "the migration adds the column and the job schedules batches after deploy", ambiguity: "the not-null constraint may be deferred or applied before the batches finish", control: "a fresh account created by the new writer",
    code: "ALTER TABLE accounts ADD COLUMN status text;\n-- backfill is dispatched by the release job\nALTER TABLE accounts ALTER COLUMN status SET NOT NULL;", codeNote: "The SQL fragment alone does not show whether the final statement is in this migration or a later phase.", neighborBehavior: "a default for new rows but no update to historical rows",
    test: "a new account under the revised writer", assertion: "status is populated on insertion", negativeTest: "migration against a snapshot containing null historical status values", testOutput: "new-writer tests passed; a snapshot migration test was not included",
    state: "historical account rows and a cursor for the backfill", stateBoundary: "the schema constraint applies globally while the job updates rows in batches", concurrent: "mixed old and new application versions", stateNote: "The old writer must either supply a value or remain compatible with a nullable column during rollout.",
    boundaryDetail: "The reader has a fallback for null but the database constraint can reject rows before code runs.", observation: "the ordering of the constraint and backfill determines whether deploy can complete", alternatives: "a later guarded constraint phase versus an immediate constraint in the same transaction",
    users: "all account writers during the rollout", symptom: "migration failure or rejected writes", frequency: "the count of historical null rows and the deploy overlap", persistence: "the schema version and partially updated rows", adjacent: "the background job may continue after the app has moved on", correlation: "migration version and batch cursor",
    rollout: "measure remaining null rows after every batch", signal: "constraint failures and old-writer insert errors", rollback: "drop the new constraint while retaining the nullable column", counter: "the new writer always supplies status", question: "is SET NOT NULL executed only after a verified zero-null backfill?", mechanics: "a nullable column is added and filled asynchronously", choice: "the timing of the constraint",
    endings: ["## Final verdict\nApprove. The `SET NOT NULL` shown in the design is a separate follow-up migration gated by a zero-null query after the backfill. The current deploy adds only a nullable column, so old writers and historical rows remain valid. Keep the snapshot migration test in the release checklist.", "## Final verdict\nRequest changes. The current migration executes `SET NOT NULL` before the asynchronous backfill begins. Any old account with null status makes deployment fail, and mixed old writers can still insert null. Split the constraint into a later migration, gate it on zero remaining nulls, and exercise a historical snapshot."] ,
  },
  {
    id: "long-bug-duplicate-job", label: "disagree", hard: true,
    scope: "the payment job claim and external charge path", entry: "workers/charge.ts:poll", middle: "queue/claims.ts:claim", exit: "gateway.capture", neighbor: "workers/ack.ts",
    invariant: "one logical payment request produces at most one external capture", input: "the same payment job observed twice after a worker restart", trace: "two captures share a job id while the queue records a retry", ambiguity: "the first claim may have raced or the ACK may have been lost after a valid claim", control: "a retry whose first capture is stubbed to fail",
    code: "const job = await claimNext(queue);\nawait gateway.capture(job.paymentId);\nawait ack(job.id);", codeNote: "The claim helper's lock lifetime and the gateway's idempotency key decide whether a retry is safe.", neighborBehavior: "an ACK after the external side effect",
    test: "a successful claim followed by ACK", assertion: "one gateway call occurs", negativeTest: "crash after capture but before ACK, then replay the job", testOutput: "the normal-path test passed; crash replay was untested",
    state: "queue visibility, row locks, gateway capture id, and ACK status", stateBoundary: "database locks end before the remote gateway transaction", concurrent: "two pollers or a process crash", stateNote: "No database lock can roll back a capture already accepted by the gateway.",
    boundaryDetail: "The queue owns delivery; the gateway owns the irreversible charge, so both identifiers must be correlated.", observation: "a repeated job id alone does not reveal whether two workers held the claim simultaneously", alternatives: "a broken claim lock versus at-least-once replay after lost ACK",
    users: "customers whose charge jobs retry", symptom: "a duplicate charge", frequency: "crash windows and queue retry policy", persistence: "gateway ledger and reconciliation records", adjacent: "the ACK worker may time out independently", correlation: "job id and gateway idempotency key",
    rollout: "add a crash-window replay test", signal: "duplicate gateway captures per payment id", rollback: "pause the worker and reconcile queued jobs", counter: "a lock query with SKIP LOCKED exists in the claim helper", question: "did both captures use distinct active claims or one claim followed by replay?", mechanics: "capture happens before ACK and the job can be delivered again", choice: "which boundary first permits the duplicate",
    endings: ["## Final diagnosis\nThe root cause is the claim query: it reads the next row before taking the lock, so two pollers can both enter `gateway.capture` during the same delivery. Move selection and lock into one transaction with `FOR UPDATE SKIP LOCKED`, and test two concurrent pollers against one job.", "## Final diagnosis\nThe root cause is a lost ACK after a successful capture. The row claim is exclusive, but the worker restarts after the gateway accepts the charge and before ACK persists. Send a stable payment idempotency key to the gateway and make replay return the first capture result; a stronger row lock alone cannot close this window."],
  },
  {
    id: "long-bug-stale-permission-cache", label: "disagree", hard: true,
    scope: "the role-change event and permission cache", entry: "api/roles.ts:updateRole", middle: "events/roles.ts:publish", exit: "auth/cache.ts:read", neighbor: "auth/cache.ts:invalidate",
    invariant: "a revoked role stops authorizing new requests after the documented invalidation window", input: "a role revoked on replica A followed by a read on replica B", trace: "the database shows the revocation while one API replica still permits the action", ambiguity: "the invalidation event may be missing or the cache key may alias a different principal", control: "a never-cached principal with the same new role state",
    code: "await roles.update(userId, newRole);\nawait roleEvents.publish({ userId });\nreturn permissionCache.get(userId);", codeNote: "The cache lookup includes only userId in the visible call; namespace composition happens inside the helper.", neighborBehavior: "event-driven eviction across replicas",
    test: "one replica updating and reading a role", assertion: "the local cache entry is cleared", negativeTest: "two replicas with delayed or reordered role events", testOutput: "single-replica tests passed; cross-replica delivery was not modeled",
    state: "database role version, per-replica cache entry, and event offset", stateBoundary: "the event bus is asynchronous and each replica has local state", concurrent: "role updates and requests on multiple replicas", stateNote: "A stale entry may be valid for a short window if the product contract explicitly allows it.",
    boundaryDetail: "The database update commits before remote eviction is observed; the cache helper might also use a tenant namespace.", observation: "the stale answer comes from cache rather than a second database read", alternatives: "missed event propagation versus cache-key collision",
    users: "principals whose roles change", symptom: "an action remains allowed after revocation", frequency: "event delivery lag and cache key cardinality", persistence: "local cache entries until eviction or TTL", adjacent: "the same cache helper serves several tenants", correlation: "user id, tenant id, role version, and event offset",
    rollout: "record role version on cache fills", signal: "authorization using a cache version behind the database", rollback: "disable permission cache reads temporarily", counter: "the role event appears in the publisher log", question: "did replica B consume the event for this principal and tenant?", mechanics: "a committed role change and a stale cached decision coexist", choice: "the precise source of staleness",
    endings: ["## Final diagnosis\nThe invalidation event is dropped by replica B when it reconnects after a broker rebalance; the cache key is correctly tenant scoped. Resume from the committed offset and replay invalidations before serving cached decisions. A key change would leave the delivery gap intact.", "## Final diagnosis\nThe event reached replica B, but the cache key omits tenant_id while eviction uses the tenant-scoped key. The stale unscoped entry survives every event and can be reused across tenants. Include tenant_id in both fill and eviction keys, flush existing entries, and add a cross-tenant regression test."],
  },
  {
    id: "long-approach-image-processing", label: "disagree",
    scope: "the image upload endpoint and processing proposal", entry: "routes/images.ts:upload", middle: "media/transform.ts", exit: "object storage", neighbor: "jobs/imageQueue.ts",
    invariant: "the client receives a durable result within the agreed latency budget", input: "a 12 MB photo requiring orientation fix and thumbnail generation", trace: "the request waits through decoding, transform, storage, and metadata write", ambiguity: "observed tail latency may justify a queue or remain inside the endpoint budget", control: "a small already-oriented image",
    code: "const decoded = await decode(file);\nconst variants = await makeVariants(decoded);\nreturn await storeAndRespond(variants);", codeNote: "The transform currently executes in the request worker and the proposed queue would move the same steps after a job receipt.", neighborBehavior: "a durable job record and retry policy",
    test: "one successful image upload", assertion: "all variants are available when the response returns", negativeTest: "a burst of large uploads under the production worker limit", testOutput: "the functional test passed; load behavior was measured separately",
    state: "uploaded bytes, variant objects, metadata row, and optional queued job", stateBoundary: "the HTTP response can be sent before or after variants become durable", concurrent: "many uploads competing for CPU and memory", stateNote: "A queued design needs explicit duplicate handling when a worker retries storage.",
    boundaryDetail: "The API contract currently returns variant URLs, while a queued response would return a job id.", observation: "both designs can produce correct images but differ in latency and failure visibility", alternatives: "synchronous completion versus durable asynchronous processing",
    users: "clients uploading photos and immediately rendering previews", symptom: "slow requests or a temporary processing state", frequency: "image sizes and burst concurrency", persistence: "stored originals and partially generated variants", adjacent: "mobile clients currently retry a timed-out upload", correlation: "upload id and variant job id",
    rollout: "measure p95 and p99 by size bucket", signal: "worker saturation, timeout rate, and queue age", rollback: "keep the old endpoint behind a route flag", counter: "median transform time is low on the developer fixture", question: "does the production tail exceed the response SLO under burst load?", mechanics: "CPU-intensive transform and storage occur before HTTP completion", choice: "whether the latency and contract warrant a queue",
    endings: ["## Final recommendation\nUse the durable image queue. The measured p99 under a realistic burst exceeds the endpoint SLO, and request retries can duplicate expensive transforms. Return a job id, persist the original first, and expose a status endpoint with idempotent variant writes. Update clients to handle processing state before switching the route.", "## Final recommendation\nKeep processing synchronous in this endpoint. The measured p99, including large images at the expected concurrency, remains within the response SLO, and clients require usable variant URLs immediately. Add admission limits and an upload idempotency key; introducing a queue would change the contract and add an unnecessary pending state."],
  },
  {
    id: "long-approach-account-lock", label: "disagree",
    scope: "the account balance update path", entry: "routes/transfers.ts", middle: "services/balance.ts", exit: "ledger entries", neighbor: "repositories/accounts.ts",
    invariant: "two transfers cannot spend the same available balance", input: "two transfers from one account arriving within the same database tick", trace: "both requests read the same starting balance and attempt writes", ambiguity: "the actual conflict rate may favor retries or a pessimistic lock", control: "transfers from unrelated accounts",
    code: "const account = await accounts.load(id);\nassertFunds(account.balance, amount);\nawait accounts.save(account.debit(amount));", codeNote: "The repository save method can enforce a version predicate or take a row lock before update.", neighborBehavior: "transactional ledger insertion after the balance write",
    test: "one transfer with enough funds", assertion: "balance and ledger agree", negativeTest: "parallel transfers whose combined amount exceeds the balance", testOutput: "single-transfer tests passed; contention tests are pending",
    state: "account balance, row version, and ledger sequence", stateBoundary: "the read-check-write sequence spans more than one SQL statement", concurrent: "several transfers on a hot account", stateNote: "Any retry must re-evaluate funds using the latest committed balance.",
    boundaryDetail: "The ledger should commit atomically with the balance change whichever lock strategy is chosen.", observation: "both optimistic and row-lock designs can preserve the invariant if implemented correctly", alternatives: "version-checked updates with bounded retries versus `SELECT FOR UPDATE`",
    users: "accounts with frequent transfers", symptom: "overspend or avoidable retry latency", frequency: "same-account contention in production", persistence: "ledger entries and available balance", adjacent: "reconciliation expects strictly ordered debits", correlation: "account id and transaction id",
    rollout: "add a conflicting-transfer integration test", signal: "conflict retry count and lock wait duration", rollback: "route transfers through the previous serial update path", counter: "ordinary accounts almost never see concurrent writes", question: "how concentrated is same-account traffic at peak?", mechanics: "the balance check precedes a write that must serialize conflicting transfers", choice: "the least costly safe serialization strategy",
    endings: ["## Final recommendation\nUse optimistic locking with a version column and a bounded retry that repeats the balance check. Production conflicts are rare outside one test account, so row locks would add wait time to the common path. Commit the ledger row with the conditional balance update and return a conflict only after the retry budget is spent.", "## Final recommendation\nUse a database row lock for this hot account path. Peak traffic repeatedly targets the same account, and version retries amplify queries before eventually serializing anyway. Take `SELECT FOR UPDATE` before checking funds, insert the ledger row in the same transaction, and monitor lock waits as the release gate."],
  },
  {
    id: "long-review-event-parser", label: "disagree",
    scope: "the streaming event parser and its partial recovery change", entry: "stream/parser.ts:consume", middle: "stream/frames.ts", exit: "event sink", neighbor: "stream/checkpoint.ts",
    invariant: "a malformed frame cannot cause later valid events to be silently lost", input: "a truncated frame followed by a complete valid frame", trace: "the parser reports one error and continues consuming bytes", ambiguity: "the continuation may resynchronize at a validated frame boundary or at an arbitrary delimiter", control: "two complete valid frames",
    code: "try { emit(parseFrame(buffer)); }\ncatch (error) { report(error); buffer = resync(buffer); }\ncheckpoint(offset);", codeNote: "The safety of recovery depends on what resync proves before advancing the checkpoint.", neighborBehavior: "persisting the last acknowledged byte offset",
    test: "a malformed frame followed by a valid one", assertion: "one error and one emitted event", negativeTest: "delimiter bytes inside a quoted payload followed by a valid frame", testOutput: "the simple recovery fixture passed; quoted delimiters were not covered",
    state: "buffer cursor, frame boundary, and durable checkpoint", stateBoundary: "checkpoint persists an offset after recovery", concurrent: "chunk boundaries and downstream backpressure", stateNote: "A checkpoint ahead of the last emitted valid event can make data loss permanent on restart.",
    boundaryDetail: "A parser error is not a transport error; recovery must know where the next frame begins.", observation: "the simple fixture proves continuation but not correct resynchronization for all payloads", alternatives: "length-prefixed verified recovery versus delimiter scanning",
    users: "consumers of batched event streams", symptom: "missing or duplicated events after a malformed frame", frequency: "malformed input and chunk boundary distribution", persistence: "checkpointed offsets and downstream records", adjacent: "the sink de-duplicates by event id but cannot restore skipped events", correlation: "stream id and byte offset",
    rollout: "add quoted-delimiter and split-chunk fixtures", signal: "gap count between input frames and emitted event ids", rollback: "disable recovery and stop at the first malformed frame", counter: "the current recovery test emits the next event", question: "does resync validate the length prefix before checkpointing?", mechanics: "the parser recovers and advances its durable offset", choice: "whether recovery has a sound boundary proof",
    endings: ["## Final verdict\nApprove. `resync` scans length prefixes and validates checksum and frame terminator before moving the cursor. The quoted delimiter remains payload data, and the checkpoint follows the last fully emitted frame. Add the proposed boundary fixture for clarity, but the recovery rule preserves valid subsequent events.", "## Final verdict\nRequest changes. `resync` searches for the next delimiter byte, including bytes inside quoted payloads, then checkpoints past the misidentified boundary. A malformed frame can therefore hide a later valid event permanently. Validate a full frame header and checksum before advancing, and add the quoted-delimiter restart test."],
  },
  {
    id: "long-approach-pagination", label: "disagree",
    scope: "the audit log pagination API", entry: "routes/audit.ts:list", middle: "repositories/audit.ts:page", exit: "the next-page token", neighbor: "db/auditIndexes.sql",
    invariant: "a client walking pages gets each matching event once in a stable order", input: "events with equal created_at timestamps while new events arrive", trace: "the first page ends at a timestamp shared by another event", ambiguity: "a tie-breaker cursor may be available or a snapshot token may be required", control: "a static log without new inserts",
    code: "const rows = await audit.page(filter, cursor, limit);\nconst next = encodeCursor(rows.at(-1));\nreturn { rows, next };", codeNote: "The cursor encoding and query ordering must use the same unique keys.", neighborBehavior: "an index over tenant_id and created_at",
    test: "two pages of a static audit log", assertion: "the combined ids match the inserted set", negativeTest: "equal timestamps plus inserts between page requests", testOutput: "the static paging test passed; concurrent insert coverage was absent",
    state: "event timestamps, unique ids, filter, and cursor token", stateBoundary: "the next-page token serializes ordering state across requests", concurrent: "new audit events inserted while a client walks pages", stateNote: "A token must also bind to the original filter to avoid mixing result sets.",
    boundaryDetail: "The API exposes only the token, so clients cannot repair gaps caused by unstable ordering.", observation: "timestamp ties require a second key regardless of storage engine", alternatives: "compound keyset cursor versus snapshot pagination",
    users: "auditors exporting large tenant logs", symptom: "duplicates or missing rows across pages", frequency: "timestamp precision and concurrent insert rate", persistence: "downloaded audit exports", adjacent: "the index order controls query cost at deep pages", correlation: "tenant id, filter hash, and cursor id",
    rollout: "test equal timestamps and mid-walk inserts", signal: "duplicate ids and count mismatch in exports", rollback: "retain the old paging version for existing tokens", counter: "ordinary fixtures use distinct timestamps", question: "must exports represent a fixed point-in-time snapshot?", mechanics: "the page boundary is encoded into a token and used for the next query", choice: "whether stable traversal alone meets the export contract",
    endings: ["## Final recommendation\nUse a compound keyset cursor `(created_at, id)`. The contract permits new records to appear on later walks, and this pair gives deterministic order without deep OFFSET scans. Bind the filter hash into the token and query with the same tuple comparison; the tie and insert test should prove no duplicate or skipped preexisting row.", "## Final recommendation\nUse snapshot pagination with a high-water mark plus `(created_at, id)` inside that snapshot. Audit exports must represent the exact event set visible when the walk began; a plain keyset cursor can include later inserts and change the export. Bind snapshot and filter to the token, and expire tokens only after the export window."],
  },
];

const AGREE_FACTS = [
  {
    id: "long-agree-timeout-cleanup", label: "agree", conclusion: "Approve. The timer is cleared on resolve, rejection, and cancellation. The focused fake-clock test checks all three exits and the retry loop holds no stale handle.",
    scope: "the retry timeout cleanup", entry: "client/request.ts:send", middle: "client/retry.ts", exit: "the returned promise", neighbor: "client/timers.ts", invariant: "every attempt releases its timer when that attempt ends", input: "a request that rejects after one retry", trace: "the timeout is registered before dispatch and cleared in finally", ambiguity: "the cancellation path could bypass the finally block", control: "a successful first attempt", code: "const timer = setTimeout(onTimeout, delay);\ntry { return await dispatch(request); }\nfinally { clearTimeout(timer); }", codeNote: "The cancellation signal enters the same awaited dispatch path.", neighborBehavior: "retry scheduling after an attempt settles", test: "resolve, reject, and abort exits with a fake clock", assertion: "zero active timers after each exit", negativeTest: "abort during the delay before a retry", testOutput: "all focused timer assertions passed", state: "one timer handle per request attempt", stateBoundary: "finally runs before retry schedules another attempt", concurrent: "several overlapping requests", stateNote: "Timer identity is local to an attempt, avoiding cross-request cleanup.", boundaryDetail: "The promise settles only after finally executes.", observation: "the active-handle count returns to baseline", alternatives: "timer leak versus cleanup on all exits", users: "clients making retried requests", symptom: "retained timeout handles", frequency: "retry and cancellation volume", persistence: "the client process heap", adjacent: "retry creates new handles on each attempt", correlation: "request id and attempt number", rollout: "track active timer count in a soak run", signal: "handle count after requests settle", rollback: "restore the prior retry implementation", counter: "the original bug appeared only after long sessions", question: "does abort still pass through finally?", mechanics: "all attempt exits execute clearTimeout", choice: "whether cleanup covers cancellation",
  },
  {
    id: "long-agree-tenant-cache-key", label: "agree", conclusion: "Request changes. The cache key uses reportId without tenantId, while reports can reuse ids across tenants. Include tenantId in fill, read, and eviction keys, then flush old entries.",
    scope: "the report cache key change", entry: "routes/reports.ts:get", middle: "cache/reports.ts", exit: "report response", neighbor: "events/reportInvalidation.ts", invariant: "cached report data is scoped to tenant and report id", input: "two tenants requesting report 42", trace: "the first response fills a shared key that the second request reads", ambiguity: "the report ids might be globally unique but the schema shows tenant-local ids", control: "distinct report ids in one tenant", code: "const key = `report:${reportId}`;\nconst cached = await cache.get(key);\nreturn cached ?? loadReport(tenantId, reportId);", codeNote: "The database load is scoped but a cache hit skips it.", neighborBehavior: "eviction using the same unscoped report id", test: "one tenant filling and reading a report", assertion: "the second read uses the cache", negativeTest: "two tenants with the same report id", testOutput: "single-tenant cache tests passed", state: "tenant-local report ids and shared cache entries", stateBoundary: "the cache key drops the tenant dimension", concurrent: "different tenants requesting the same local id", stateNote: "The shared cache outlives any one HTTP request.", boundaryDetail: "A scoped database lookup cannot protect a later unscoped cache hit.", observation: "the second tenant receives the first tenant's cached payload", alternatives: "globally unique ids versus tenant-local ids", users: "tenants sharing the report cache", symptom: "wrong-tenant report data", frequency: "overlapping local ids", persistence: "cache TTL", adjacent: "invalidation also targets the wrong key", correlation: "tenant id and report id", rollout: "add the cross-tenant fixture", signal: "cache hits with mismatched tenant metadata", rollback: "disable shared cache reads", counter: "the database query itself is correctly scoped", question: "are report ids unique only within tenant?", mechanics: "the cache key omits tenantId", choice: "whether reportId alone identifies a report",
  },
  {
    id: "long-agree-cursor-export", label: "agree", conclusion: "Recommend streaming the CSV with a database cursor and response backpressure. The current materialization grows with row count and exceeds the worker memory budget on large exports.",
    scope: "the CSV export memory path", entry: "routes/export.ts", middle: "repositories/exportRows.ts", exit: "the HTTP response", neighbor: "csv/encode.ts", invariant: "export memory stays bounded as row count grows", input: "a 2 million row export", trace: "the query materializes rows before the first response byte", ambiguity: "the small fixture hides the large production row count", control: "a 100 row export", code: "const rows = await db.query(exportSql);\nconst csv = encodeCsv(rows);\nres.send(csv);", codeNote: "Both rows and encoded CSV can occupy memory at once.", neighborBehavior: "building one complete string from the row array", test: "a small CSV result", assertion: "the header and row order are correct", negativeTest: "large cursor export under a constrained heap", testOutput: "content assertions passed on the small fixture", state: "database cursor position and writable response buffer", stateBoundary: "backpressure must pause reads from the database", concurrent: "multiple exports on one worker", stateNote: "Client disconnect should close the cursor promptly.", boundaryDetail: "The response stream must propagate errors and cancellation to the query.", observation: "heap growth follows row count in the current approach", alternatives: "materialize all rows versus stream bounded batches", users: "administrators exporting large datasets", symptom: "worker OOM or request timeout", frequency: "large export volume", persistence: "partial downloads and worker restarts", adjacent: "CSV encoding can process one row at a time", correlation: "export id and batch number", rollout: "measure heap at increasing row counts", signal: "peak heap and response stall duration", rollback: "cap exports while the cursor path is fixed", counter: "small exports are fast", question: "does the DB driver support cursor cleanup on abort?", mechanics: "the current implementation holds all rows and CSV", choice: "how to bound memory without breaking CSV order",
  },
  {
    id: "long-agree-utc-date", label: "agree", conclusion: "Root cause: the handler parses a date-only value as a UTC timestamp, then formats it in the account's local zone. Preserve a date-only type through validation and persistence.",
    scope: "the date-only invoice period parser", entry: "routes/period.ts", middle: "time/parse.ts", exit: "the saved period", neighbor: "db/periods.ts", invariant: "a calendar date remains the same date in the account's zone", input: "2026-03-01 for an account west of UTC", trace: "the parser creates midnight Z and local formatting shows the previous day", ambiguity: "a timestamp field would need different semantics but this API declares a date-only field", control: "an account in UTC", code: "const instant = new Date(input.periodStart);\nconst shown = formatInZone(instant, account.zone);\nawait periods.save(shown);", codeNote: "The constructor interprets the bare date as UTC midnight.", neighborBehavior: "saving a date string without timezone metadata", test: "a UTC account period", assertion: "the saved date matches input", negativeTest: "a west-of-UTC account at a month boundary", testOutput: "UTC fixture passed and zone coverage was absent", state: "input calendar date and account time zone", stateBoundary: "a date-only value is converted into an instant", concurrent: "accounts in different zones", stateNote: "The same input must not depend on the server's zone.", boundaryDetail: "Validation accepts YYYY-MM-DD but the next layer widens it to Date.", observation: "the date shifts only after that conversion", alternatives: "date-only domain value versus UTC instant", users: "accounts outside UTC", symptom: "billing period starts a day early", frequency: "zone offset and period boundary", persistence: "saved invoice periods", adjacent: "period queries compare date strings", correlation: "account id and submitted date", rollout: "add zone matrix tests", signal: "mismatch between submitted and saved dates", rollback: "restore prior date-only parsing", counter: "the UTC account test remains green", question: "does the API field represent a calendar date?", mechanics: "UTC midnight becomes prior local day", choice: "the domain type of periodStart",
  },
];

// A mesma análise longa para discordâncias; só a seção final difere.
export const FANOUT_LONG_CASES = [
  ...AGREE_FACTS.map((facts) => ({
    id: facts.id, label: facts.label, long: true,
    outputs: [
      `${longWalkthrough(facts, "files")}\n\n## Final verdict\n${facts.conclusion}`,
      `${longWalkthrough(facts, "execution")}\n\n## Recommendation\n${facts.conclusion}`,
    ],
  })),
  ...LONG_FACTS.map((facts) => ({
    id: facts.id, label: facts.label, hard: facts.hard ?? false, long: true,
    outputs: facts.endings.map((ending) => `${longWalkthrough(facts)}\n\n${ending}`),
  })),
];

export const SHADOW_CASES = [
  { id: "rename-symbol", expected: 1, ok: [1, 1], prompt: "Rename the local variable `res` to `response` in one function, preserving behavior." },
  { id: "fix-copy", expected: 1, ok: [1, 1], prompt: "Correct the typo 'recieve' in one user-facing label and its snapshot." },
  { id: "add-log-line", expected: 1, ok: [1, 2], prompt: "Add one debug log after the existing retry decision, using the nearby logger convention." },
  { id: "update-doc-link", expected: 1, ok: [1, 1], prompt: "Replace an obsolete documentation URL in README.md with the supplied new URL." },
  { id: "small-commit", expected: 1, ok: [1, 1], prompt: "Commit the already-reviewed two-line config change with the provided message; do not edit code." },

  { id: "routine-endpoint", expected: 2, ok: [2, 3], prompt: "Add a GET /projects/:id endpoint following the existing router, service, validation and error patterns, plus focused tests." },
  { id: "routine-form", expected: 2, ok: [2, 3], prompt: "Implement an edit profile form with the existing React form library, loading state, validation and save feedback." },
  { id: "routine-filter", expected: 2, ok: [1, 2], prompt: "Add a status filter to the existing list endpoint and update its query tests." },
  { id: "routine-export", expected: 2, ok: [2, 3], prompt: "Add CSV download for the current report using the project's existing exporter and permission checks." },
  { id: "routine-metric", expected: 2, ok: [2, 2], prompt: "Instrument the existing job runner with a duration metric, labels, and a dashboard query, following current metrics conventions." },

  { id: "complex-migration", expected: 3, ok: [3, 4], prompt: "Split the monolithic settings table into tenant and user settings with a backwards-compatible migration, dual reads during rollout, and tests." },
  { id: "complex-offline", expected: 3, ok: [3, 4], prompt: "Add offline editing with local queueing, conflict resolution on reconnect, and a migration for cached records across app versions." },
  { id: "complex-parser", expected: 3, ok: [2, 3], prompt: "Implement a streaming parser for nested event batches with partial recovery, bounded memory, and property-based tests." },
  { id: "complex-api", expected: 3, ok: [3, 4], prompt: "Move three API clients to a common error envelope while preserving public interfaces and retry semantics across packages." },
  { id: "complex-cache", expected: 3, ok: [3, 4], prompt: "Design and implement cache invalidation for user permissions across replicas, including event ordering and replay handling." },

  { id: "hard-deadlock", expected: 4, ok: [3, 4], prompt: "Diagnose an intermittent production deadlock across payment, ledger and reconciliation transactions. Reproduce from traces, locate lock ordering, and fix it safely." },
  { id: "hard-memory", expected: 4, ok: [3, 4], prompt: "Find a gradual memory leak that appears only after days of websocket reconnects across client and server; profile it and prove the fix." },
  { id: "hard-auth", expected: 4, ok: [4, 5], prompt: "Trace an intermittent cross-tenant authorization leak through middleware, cache and async job paths, then repair all affected flows." },
  { id: "hard-rollback", expected: 4, ok: [3, 4], prompt: "Plan and implement a safe rollback for a partially deployed schema change affecting four services and mixed old/new writers." },
  { id: "hard-perf", expected: 4, ok: [3, 4], prompt: "Investigate a 10x p99 latency regression under load involving database locks, queue backpressure and cross-service retries; establish the cause with measurements." },

  { id: "frontier-protocol", expected: 5, ok: [4, 5], prompt: "Invent and formally validate a novel consensus protocol under Byzantine faults and partial synchrony with a proof of safety and liveness, then assess implementation tradeoffs." },
  { id: "frontier-compiler", expected: 5, ok: [4, 5], prompt: "Derive a new compiler optimization for a language with dependent effects, prove semantic preservation, and implement a prototype across optimizer passes." },
  { id: "frontier-crypto", expected: 5, ok: [5, 5], prompt: "Develop a new zero-knowledge proof construction for dynamic graph reachability with a rigorous security argument and benchmarkable prototype." },
  { id: "frontier-systems", expected: 5, ok: [4, 5], prompt: "Design a new distributed transaction algorithm for cross-region, offline-capable clients with provable consistency guarantees and quantified fault tolerance." },
  { id: "frontier-research", expected: 5, ok: [4, 5], prompt: "Evaluate competing unproven approaches to verified autonomous program repair, derive a new method, and defend its soundness assumptions with formal reasoning." },
];

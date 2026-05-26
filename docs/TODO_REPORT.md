# Consolidated TODO Report

This file consolidates all remaining TODO/todo/FIXME markers found in repository documentation. Each entry below lists the file, the original snippet, and a suggested action. Use this as the single source-of-truth to triage, convert to issues, or implement documentation fixes.

## How to use
- Create issues in your tracker for high-priority TODOs and reference the file/path below.
- When a TODO is resolved, update the original doc and remove the TODO from this report.

---

## Items

1. File: fabric-samples/full-stack-asset-transfer-guide/docs/CloudReady/30-chaincode.md
   - Snippet: "prepare a chaincode package with connection.json -> HOST IP:9999  (todo: link to dig out)"
   - Suggested action: Add link to instructions for creating a connection.json for Chaincode-as-a-Service; provide example connection.json and reference.

2. File: fabric-samples/full-stack-asset-transfer-guide/docs/CloudReady/11-kube-multipass.md
   - Snippets: several lines marked `todo` about SCP vs volume mounts and SSH/authorized_keys.
   - Suggested action: Decide whether to copy files via `scp` or rely on multipass mount; provide explicit commands and update the guide.

3. File: fabric-samples/test-network-k8s/docs/APPLICATIONS.md
   - Snippet: "TODO: this section is a work-in-progress." and "#### TODO: Deploy"
   - Suggested action: Flesh out the deployment steps or link to an existing how-to; convert to issue for content owners.

4. File: fabric-samples/full-stack-asset-transfer-guide/docs/ApplicationDev/04-Exercise-AssetTransfer-ES.md
   - Snippet: Note about `transferAsset()` not implemented.
   - Suggested action: Update the exercise to reflect that `transferAsset()` is implemented in the sample code; provide instructions to build and test. (Code already updated in repository.)

5. Miscellaneous: other `todo.md` and `todo` link placeholders across the `full-stack-asset-transfer-guide` docs.
   - Suggested action: Replace placeholder links with real external links (e.g., KIND), or move specific TODOs into issues.

---

If you want, I can:
- Convert each TODO into a GitHub issue draft file under `.github/ISSUE_TEMPLATES/` or `docs/todo-issues.md`.
- Open a PR that implements the low-effort doc fixes listed above.

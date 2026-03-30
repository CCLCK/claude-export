# Security Policy

## Scope

This repository is public. Treat all committed content as permanently visible.

## Do Not Commit

Do **not** commit any of the following:

- exported HTML or Markdown files generated from real Claude conversations
- screenshots of real conversations, exported pages, attachments, or reviews
- real chat samples, prompts, responses, or copied conversation fragments
- local absolute filesystem paths such as `/Users/...`, mounted volumes, vault paths, or desktop paths
- API keys, access tokens, cookies, session identifiers, auth headers, or private credentials
- private attachments, downloaded source files, reviewer documents, PDFs, or images from real work

## Public Repository Hygiene

Before pushing changes:

1. Check `git status` and confirm only source files are staged.
2. Verify no generated export artifacts are included.
3. Search diffs for absolute local paths, Claude chat links, and secrets.
4. Prefer synthetic fixtures or redacted examples when testing.

## Reporting

If you discover sensitive content was committed:

1. Revoke any exposed credential immediately.
2. Remove the content from the working tree.
3. Rewrite git history if the data was already committed.
4. Rotate related keys or sessions before making the repository public again.

## Commercial Use

This repository is published with a non-commercial restriction as stated in the project README. Do not use the code or derivative workflow for commercial purposes without explicit authorization.

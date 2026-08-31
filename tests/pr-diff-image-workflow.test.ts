import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const renderWorkflow = new URL("../.github/workflows/pr-diff-image.yml", import.meta.url);
const publishWorkflow = new URL("../.github/workflows/publish-pr-diff-image.yml", import.meta.url);

describe("pull request diff image workflows", () => {
  it("renders untrusted pull request code with read-only permissions", async () => {
    const workflow = await readFile(renderWorkflow, "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).not.toContain("pull_request_target:");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("npm ci --ignore-scripts");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain('"$BASE_SHA...$HEAD_SHA"');
    expect(workflow).toContain("--no-open");
    expect(workflow).not.toContain("--export");
    expect(workflow).toContain("slopsplorer-pr-diff-image");
    expect(workflow).toContain("capture-pr-diff-image.mjs");
    expect(workflow).not.toContain("--screenshot=");

    const captureScript = await readFile(
      new URL("../.github/scripts/capture-pr-diff-image.mjs", import.meta.url),
      "utf8",
    );
    expect(captureScript).toContain('document.title.endsWith(" - Slopsplorer diff")');
    expect(captureScript).toContain("Page.captureScreenshot");
  });

  it("publishes only a completed render artifact without executing it", async () => {
    const workflow = await readFile(publishWorkflow, "utf8");

    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain('cron: "17 5 * * *"');
    expect(workflow).toContain('workflows: ["PR diff image"]');
    expect(workflow).toContain("github.event.workflow_run.event == 'pull_request'");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).toContain("pull-requests: write");
    expect(workflow).not.toContain("actions/checkout");
    expect(workflow).toContain("${{ runner.temp }}/slopsplorer-pr-diff-artifact");
    expect(workflow).toContain('test ! -L "$ARTIFACT_ROOT/pr-diff.png"');
    expect(workflow).toContain("dimensions[0] === 2042 && dimensions[1] >= 1462 && dimensions[1] <= 8192");
    expect(workflow).toContain("dimensions[0] === 2880 && dimensions[1] >= 1800 && dimensions[1] <= 8192");
    expect(workflow).toContain("secrets.TIGRIS_ACCESS_KEY_ID");
    expect(workflow).toContain("secrets.TIGRIS_SECRET_ACCESS_KEY");
    expect(workflow).toContain("vars.TIGRIS_BUCKET");
    expect(workflow).toContain("--aws-sigv4 'aws:amz:auto:s3'");
    expect(workflow).toContain("x-amz-meta-workflow-run");
    expect(workflow).toContain('image_path="pr-$PR_NUMBER-$HEAD_SHA.png"');
    expect(workflow).toContain('image_path="pr-$pr_number-$current_head.png"');
    expect(workflow).not.toContain('image_path="pr-$PR_NUMBER.png"');
    expect(workflow).toContain("--expires-in 604800");
    expect(workflow).not.toContain("x-amz-acl: public-read");
    expect(workflow).toContain("aws s3api head-object");
    expect(workflow).toContain("github.event_name == 'schedule'");
    expect(workflow).toContain("<!-- slopsplorer-pr-diff-image -->");
    expect(workflow).toContain("github.event.workflow_run.id");
    expect(workflow).not.toMatch(/(?:node|npm|npx|bash|sh|source|\.\/) (?:artifact\/)?pr-diff/);
  });
});

/**
 * Integration test: full init / plan / apply / destroy cycle.
 *
 * Runs against a real Terraform binary, downloaded into a temporary trunner
 * home on first run. Skipped automatically if `TRUNNER_SKIP_INTEGRATION=1`.
 *
 * To pin the Terraform version: TRUNNER_TERRAFORM_VERSION=1.6.6
 * To reuse a binary already on PATH:   TRUNNER_TERRAFORM_BIN=/path/to/terraform
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SKIP = process.env['TRUNNER_SKIP_INTEGRATION'] === '1';
const VERSION = process.env['TRUNNER_TERRAFORM_VERSION'] ?? '1.6.6';
const EXTERNAL_BIN = process.env['TRUNNER_TERRAFORM_BIN'];

const skipReason = SKIP
  ? 'TRUNNER_SKIP_INTEGRATION=1 set'
  : EXTERNAL_BIN
    ? `using external binary: ${EXTERNAL_BIN}`
    : `will download Terraform ${VERSION}`;

const FIXTURE_HCL = `terraform {
  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
}

resource "null_resource" "trunner_test" {
  count = 1

  triggers = {
    value = "trunner-poc"
  }
}
`;

describe.skipIf(SKIP)('integration: full terraform cycle', () => {
  let home: string;
  let terraformPath: string;
  let workingDir: string;
  let runner: Awaited<ReturnType<typeof import('../../src/index.js').createRunner>>;

  beforeAll(async () => {
    const sdk = await import('../../src/index.js');
    home = join(tmpdir(), `trunner-int-${Date.now()}-${Math.random()}`);
    await fsp.mkdir(home, { recursive: true });

    const paths = sdk.getPaths(home);
    await sdk.ensurePaths(paths);

    const tool = new sdk.TerraformTool({ logger: new sdk.NoopLogger() });
    const config = new sdk.ConfigStore(paths);

    if (EXTERNAL_BIN) {
      terraformPath = EXTERNAL_BIN;
    } else {
      terraformPath = await tool.binary.ensureInstalled({ version: VERSION });
      await config.pinTool('terraform', {
        version: VERSION,
        installedAt: new Date().toISOString(),
        source: 'official',
      });
    }

    workingDir = join(home, 'fixture');
    await fsp.mkdir(workingDir, { recursive: true });
    await fsp.writeFile(join(workingDir, 'main.tf'), FIXTURE_HCL);

    runner = sdk.createRunner({ paths, logger: new sdk.NoopLogger() });
  }, 300_000);

  afterAll(async () => {
    if (home) await fsp.rm(home, { recursive: true, force: true });
  });

  it('runs init → plan → apply → destroy', async () => {
    // init (with -input=false to avoid prompts)
    const initArgs = toolCommands('init', { autoApprove: true });
    let res = await runner.run({
      binaryPath: terraformPath,
      args: initArgs,
      cwd: workingDir,
    });
    expect(res.exitCode, `init failed:\n${res.stderr}\n${res.stdout}`).toBe(0);

    // plan (save plan to file)
    res = await runner.run({
      binaryPath: terraformPath,
      args: ['plan', '-out=tfplan', '-input=false'],
      cwd: workingDir,
    });
    expect(res.exitCode, `plan failed:\n${res.stderr}\n${res.stdout}`).toBe(0);

    // apply (auto-approve)
    res = await runner.run({
      binaryPath: terraformPath,
      args: ['apply', '-input=false', '-auto-approve', 'tfplan'],
      cwd: workingDir,
    });
    expect(res.exitCode, `apply failed:\n${res.stderr}\n${res.stdout}`).toBe(0);
    expect(res.parsed?.changes?.add).toBe(1);

    // destroy (auto-approve)
    res = await runner.run({
      binaryPath: terraformPath,
      args: ['destroy', '-input=false', '-auto-approve'],
      cwd: workingDir,
    });
    expect(res.exitCode, `destroy failed:\n${res.stderr}\n${res.stdout}`).toBe(0);
    expect(res.parsed?.changes?.destroy).toBe(1);
  }, 300_000);
});

function toolCommands(name: string, opts: { autoApprove?: boolean } = {}) {
  return [name, ...(opts.autoApprove ? ['-input=false'] : [])];
}

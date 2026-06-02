import { describe, expect, it } from 'vitest';
import { parseLockFileString, parseRequiredProvidersString } from '../../src/tools/terraform/provider.js';

describe('terraform/provider (HCL parsing)', () => {
  it('parses a typical .terraform.lock.hcl', async () => {
    const hcl = `# This file is maintained automatically by "terraform init"
provider "registry.terraform.io/hashicorp/local" {
  version     = "2.5.1"
  constraints = ">= 2.0.0"
  hashes = [
    "h1:abcd",
    "zh:1234",
  ]
}
`;
    const parsed = await parseLockFileString(hcl);
    expect(parsed.providers).toHaveLength(1);
    expect(parsed.providers[0]).toMatchObject({
      source: 'registry.terraform.io/hashicorp/local',
      version: '2.5.1',
    });
    expect(parsed.providers[0]?.hashes.length).toBe(2);
  });

  it('parses multiple providers in a lock file', async () => {
    const hcl = `provider "registry.terraform.io/hashicorp/null" {
  version = "3.2.1"
  hashes  = ["h1:aaa"]
}
provider "registry.terraform.io/hashicorp/random" {
  version = "3.6.0"
  hashes  = ["h1:bbb"]
}
`;
    const parsed = await parseLockFileString(hcl);
    expect(parsed.providers).toHaveLength(2);
    expect(parsed.providers.map((p) => p.source).sort()).toEqual([
      'registry.terraform.io/hashicorp/null',
      'registry.terraform.io/hashicorp/random',
    ]);
  });

  it('parses terraform.required_providers', async () => {
    const hcl = `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source = "hashicorp/random"
    }
  }
}
`;
    const parsed = await parseRequiredProvidersString(hcl);
    const sources = parsed.providers.map((p) => p.source).sort();
    expect(sources).toEqual(['hashicorp/aws', 'hashicorp/random']);
    const aws = parsed.providers.find((p) => p.source === 'hashicorp/aws');
    expect(aws?.version).toBe('~> 5.0');
    const random = parsed.providers.find((p) => p.source === 'hashicorp/random');
    expect(random?.version).toBeUndefined();
  });

  it('parses top-level required_providers block (newer style)', async () => {
    const hcl = `required_providers {
  aws = {
    source  = "hashicorp/aws"
    version = "5.10.0"
  }
}
`;
    const parsed = await parseRequiredProvidersString(hcl);
    expect(parsed.providers).toHaveLength(1);
    expect(parsed.providers[0]?.source).toBe('hashicorp/aws');
  });

  it('returns an empty list for content without providers', async () => {
    const parsed = await parseLockFileString('# nothing here\n');
    expect(parsed.providers).toEqual([]);
  });
});
